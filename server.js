const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configurar axios para simular um navegador real
const axiosInstance = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    },
    timeout: 30000
});

// Função para extrair dados da série
async function extractSeriesData(url) {
    try {
        console.log(`🔍 Acessando URL: ${url}`);
        
        const response = await axiosInstance.get(url);
        console.log(`📄 Status: ${response.status}, Tamanho: ${response.data.length}`);
        
        const $ = cheerio.load(response.data);
        
        const seriesData = {
            title: '',
            seasons: []
        };

        // Extrair título da página
        const pageTitle = $('title').text();
        console.log('📝 Título da página:', pageTitle);
        
        // Limpar o título
        seriesData.title = pageTitle.replace('(Dublado)', '').replace('(Legendado)', '').trim();

        // Estratégia 1: Procurar por elementos específicos que contenham os dados
        console.log('🔍 Procurando por conteúdo...');

        // Buscar todas as tags que podem conter os episódios
        const contentSelectors = [
            'p',
            'div',
            'section',
            'article',
            '.content',
            '#content',
            '.episodes',
            '.season'
        ];

        let foundContent = null;

        for (const selector of contentSelectors) {
            const elements = $(selector);
            console.log(`🔍 Seletor "${selector}": ${elements.length} elementos`);
            
            elements.each((index, element) => {
                const $element = $(element);
                const text = $element.text();
                
                // Verificar se contém informações de episódios
                if (text.includes('Episódio') && text.includes('Temporada')) {
                    console.log(`✅ Possível container encontrado com: ${selector}`);
                    console.log(`📋 Amostra: ${text.substring(0, 100)}...`);
                    foundContent = $element;
                    return false; // break
                }
            });
            
            if (foundContent) break;
        }

        // Se não encontrou, usar o body
        if (!foundContent) {
            console.log('ℹ️ Usando body como fallback');
            foundContent = $('body');
        }

        // Extrair todo o texto para análise
        const fullText = foundContent.text();
        console.log('📋 Texto completo (primeiros 500 chars):', fullText.substring(0, 500));

        // Processar o conteúdo
        const lines = fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        let currentSeason = null;
        const seasons = [];

        lines.forEach((line, index) => {
            // Verificar se é uma temporada
            if (line.match(/\d+ª\s*Temporada/i) || line.includes('Temporada')) {
                console.log(`🎬 Temporada encontrada: ${line}`);
                
                if (currentSeason && currentSeason.episodes.length > 0) {
                    seasons.push(currentSeason);
                }
                
                currentSeason = {
                    season: line,
                    episodes: []
                };
                return;
            }

            // Verificar se é um episódio
            if (line.includes('Episódio') && currentSeason) {
                console.log(`📺 Episódio encontrado: ${line}`);
                
                const episodeData = extractEpisodeFromText(line, foundContent);
                if (episodeData) {
                    currentSeason.episodes.push(episodeData);
                }
            }
        });

        // Adicionar a última temporada
        if (currentSeason && currentSeason.episodes.length > 0) {
            seasons.push(currentSeason);
        }

        seriesData.seasons = seasons;

        console.log(`📊 Resumo: ${seasons.length} temporadas, ${seasons.reduce((acc, s) => acc + s.episodes.length, 0)} episódios`);

        return seriesData;

    } catch (error) {
        console.error('❌ Erro ao extrair dados:', error.message);
        throw new Error(`Erro ao extrair dados: ${error.message}`);
    }
}

// Função para extrair episódio do texto
function extractEpisodeFromText(line, $container) {
    try {
        const episodeData = {
            episode: '',
            title: '',
            links: {}
        };

        // Extrair número do episódio
        const episodeMatch = line.match(/Episódio\s+(\d+)/i);
        if (episodeMatch) {
            episodeData.episode = `Episódio ${episodeMatch[1]}`;
        }

        // Extrair título (se existir)
        const titleMatch = line.match(/Episódio\s+\d+\s*-\s*(.+?)(?:\s*$)/i);
        if (titleMatch && titleMatch[1].trim() && titleMatch[1].trim() !== '-') {
            episodeData.title = titleMatch[1].trim();
        }

        // Buscar links no container - estratégia mais agressiva
        $container.find('a').each((i, link) => {
            const $link = $(link);
            const href = $link.attr('href');
            const text = $link.text().trim();
            const parentText = $link.parent().text();

            // Verificar se este link está relacionado ao episódio atual
            if (href && parentText.includes(line.substring(0, 20))) {
                const fullUrl = `https://redecanais.sh${href}`;
                
                if (text === 'Assistir' || text === 'Dublado' || text === 'Legendado') {
                    episodeData.links[text.toLowerCase()] = fullUrl;
                } else if (text && !episodeData.links.assistir) {
                    episodeData.links.assistir = fullUrl;
                }
            }
        });

        return Object.keys(episodeData.links).length > 0 ? episodeData : null;

    } catch (error) {
        console.error('❌ Erro ao extrair episódio:', error);
        return null;
    }
}

// Endpoint principal
app.get('/api/series', async (req, res) => {
    const { url } = req.query;

    console.log(`📍 Recebida requisição para URL: ${url}`);

    if (!url) {
        return res.status(400).json({
            error: 'URL é obrigatória. Use: /api/series?url=URL_DA_SERIE'
        });
    }

    try {
        if (!url.includes('redecanais.sh')) {
            return res.status(400).json({
                error: 'URL deve ser do domínio redecanais.sh'
            });
        }

        const seriesData = await extractSeriesData(url);
        
        res.json({
            success: true,
            data: seriesData,
            debug: {
                url: url,
                timestamp: new Date().toISOString(),
                seasonsCount: seriesData.seasons.length,
                totalEpisodes: seriesData.seasons.reduce((acc, season) => acc + season.episodes.length, 0)
            }
        });

    } catch (error) {
        console.error('❌ Erro na API:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            debug: {
                url: url,
                timestamp: new Date().toISOString()
            }
        });
    }
});

// Endpoint de debug melhorado
app.get('/api/debug', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL é obrigatória' });
    }

    try {
        const response = await axiosInstance.get(url);
        const $ = cheerio.load(response.data);

        // Coletar informações úteis
        const info = {
            url: url,
            status: response.status,
            title: $('title').text(),
            metaDescription: $('meta[name="description"]').attr('content'),
            bodyLength: $('body').text().length,
            allLinks: $('a').length,
            possibleContentElements: []
        };

        // Encontrar elementos que podem conter o conteúdo
        $('p, div, section, article').each((index, element) => {
            const $element = $(element);
            const text = $element.text().trim();
            
            if (text && (text.includes('Episódio') || text.includes('Temporada'))) {
                info.possibleContentElements.push({
                    tag: element.tagName,
                    class: $element.attr('class'),
                    id: $element.attr('id'),
                    text: text.substring(0, 150),
                    links: $element.find('a').length
                });
            }
        });

        // Amostra do HTML
        info.htmlSample = response.data.substring(0, 2000);

        res.json(info);

    } catch (error) {
        res.status(500).json({ 
            error: error.message,
            response: error.response ? {
                status: error.response.status,
                headers: error.response.headers
            } : null
        });
    }
});

// Endpoint de saúde
app.get('/health', (req, res) => {
    res.json({ 
        status: 'API funcionando', 
        timestamp: new Date().toISOString(),
        version: '1.1.0'
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'API de Extração de Séries - Rede Canais v1.1',
        endpoints: {
            '/api/series': 'Extrair dados da série',
            '/api/debug': 'Debug detalhado',
            '/health': 'Status da API'
        },
        exemplo: 'https://effective-pancake-wgc5.onrender.com/api/series?url=https://redecanais.sh/browse-alice-in-borderland-videos-1-date.html'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📡 Acesse: http://localhost:${PORT}`);
});
