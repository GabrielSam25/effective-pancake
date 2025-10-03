const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Função para extrair dados da série
async function extractSeriesData(url) {
    try {
        console.log(`🔍 Acessando URL: ${url}`);
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        
        const seriesData = {
            title: '',
            seasons: []
        };

        // DEBUG: Ver todo o HTML
        console.log('📄 HTML carregado, tamanho:', response.data.length);

        // Extrair título da série - múltiplas estratégias
        let title = '';

        // Estratégia 1: Do nome do arquivo da imagem
        const imageSrc = $('img').first().attr('src');
        console.log('🖼️ Imagem encontrada:', imageSrc);
        
        if (imageSrc) {
            const titleMatch = imageSrc.match(/\/([^\/]+)%20Capa\.jpg/);
            if (titleMatch) {
                title = decodeURIComponent(titleMatch[1]).replace(/%20/g, ' ');
                console.log('📝 Título da imagem:', title);
            }
        }

        // Estratégia 2: Do título da página
        if (!title) {
            const pageTitle = $('title').text();
            console.log('📄 Título da página:', pageTitle);
            // Extrair nome da série do título
            const titleMatch = pageTitle.match(/(.+?)\s*-\s*Rede Canais/);
            if (titleMatch) {
                title = titleMatch[1].trim();
                console.log('📝 Título extraído:', title);
            }
        }

        seriesData.title = title;

        // Buscar o container principal - vamos tentar diferentes seletores
        let contentContainer = null;

        // Tentar diferentes seletores possíveis
        const possibleSelectors = [
            'p[style*="outline"]',
            'p',
            '.content',
            '#content',
            'div p',
            'body > p'
        ];

        for (const selector of possibleSelectors) {
            const element = $(selector).first();
            if (element.length > 0) {
                console.log(`✅ Container encontrado com seletor: ${selector}`);
                contentContainer = element;
                break;
            }
        }

        if (!contentContainer) {
            console.log('❌ Nenhum container encontrado');
            // Tentar pegar todo o body
            contentContainer = $('body');
        }

        console.log('📦 Conteúdo do container:', contentContainer.html().substring(0, 200) + '...');

        let currentSeason = null;
        const seasons = [];

        // Processar todos os elementos filhos do container
        contentContainer.contents().each((index, element) => {
            const $element = $(element);
            const text = $element.text().trim();

            // Pular elementos vazios
            if (!text) return;

            console.log(`🔍 Elemento ${index}:`, text.substring(0, 50) + '...');

            // Verificar se é um título de temporada
            if (text.match(/\d+ª\s*Temporada/) || text.includes('Temporada')) {
                console.log(`🎬 ENCONTRADA TEMPORADA: ${text}`);
                
                if (currentSeason) {
                    seasons.push(currentSeason);
                }
                
                currentSeason = {
                    season: text,
                    episodes: []
                };
                return;
            }

            // Verificar se é um episódio
            if (text.includes('Episódio') && currentSeason) {
                console.log(`📺 ENCONTRADO EPISÓDIO: ${text}`);
                const episodeData = extractEpisodeData($element);
                if (episodeData) {
                    currentSeason.episodes.push(episodeData);
                    console.log(`✅ Episódio adicionado: ${episodeData.episode}`);
                }
            }
        });

        // Adicionar a última temporada se existir
        if (currentSeason && currentSeason.episodes.length > 0) {
            seasons.push(currentSeason);
        }

        seriesData.seasons = seasons;

        console.log(`📊 Resumo: ${seasons.length} temporadas encontradas`);
        seasons.forEach((season, index) => {
            console.log(`  Temporada ${index + 1}: ${season.episodes.length} episódios`);
        });

        return seriesData;
    } catch (error) {
        console.error('❌ Erro ao extrair dados:', error.message);
        throw new Error(`Erro ao extrair dados da série: ${error.message}`);
    }
}

// Função para extrair dados de um episódio
function extractEpisodeData($element) {
    try {
        const episodeData = {
            episode: '',
            title: '',
            links: {}
        };

        const episodeText = $element.text().trim();
        console.log('📋 Texto do episódio:', episodeText);

        // Extrair número do episódio
        const episodeMatch = episodeText.match(/Episódio\s+(\d+)/i);
        if (episodeMatch) {
            episodeData.episode = `Episódio ${episodeMatch[1]}`;
        } else {
            // Tentar padrão alternativo
            const altMatch = episodeText.match(/Ep\.?\s*(\d+)/i);
            if (altMatch) {
                episodeData.episode = `Episódio ${altMatch[1]}`;
            }
        }

        // Extrair título do episódio (se existir)
        const titleMatch = episodeText.match(/Episódio\s+\d+\s*-\s*(.+?)(?:\s*(?:Dublado|Legendado|Assistir)|$)/i);
        if (titleMatch && titleMatch[1].trim() && titleMatch[1].trim() !== '-') {
            episodeData.title = titleMatch[1].trim();
        }

        // Extrair links
        $element.find('a').each((i, link) => {
            const $link = $(link);
            const href = $link.attr('href');
            const text = $link.text().trim();
            
            if (href) {
                const fullUrl = `https://redecanais.sh${href}`;
                
                if (text === 'Assistir' || text === 'Dublado' || text === 'Legendado') {
                    episodeData.links[text.toLowerCase()] = fullUrl;
                    console.log(`🔗 Link ${text}: ${fullUrl}`);
                } else if (!episodeData.links.assistir) {
                    // Se não tem texto específico, assume como "assistir"
                    episodeData.links.assistir = fullUrl;
                }
            }
        });

        // Se não encontrou links, tentar extrair do elemento pai
        if (Object.keys(episodeData.links).length === 0) {
            $element.parent().find('a').each((i, link) => {
                const $link = $(link);
                const href = $link.attr('href');
                const text = $link.text().trim();
                
                if (href) {
                    const fullUrl = `https://redecanais.sh${href}`;
                    episodeData.links[text.toLowerCase()] = fullUrl;
                    console.log(`🔗 Link alternativo ${text}: ${fullUrl}`);
                }
            });
        }

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
        // Validar se a URL é do Rede Canais
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

// Endpoint de debug - retorna HTML bruto para análise
app.get('/api/debug', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL é obrigatória' });
    }

    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        
        // Encontrar todos os elementos possíveis
        const elements = [];
        $('p, div, span').each((index, element) => {
            const $element = $(element);
            const text = $element.text().trim();
            if (text && (text.includes('Episódio') || text.includes('Temporada'))) {
                elements.push({
                    tag: element.tagName,
                    text: text.substring(0, 100),
                    html: $element.html().substring(0, 200)
                });
            }
        });

        res.json({
            url: url,
            title: $('title').text(),
            elements: elements,
            htmlSample: response.data.substring(0, 1000)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint de saúde
app.get('/health', (req, res) => {
    res.json({ 
        status: 'API funcionando', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Rota raiz
app.get('/', (req, res) => {
    res.json({
        message: 'API de Extração de Séries - Rede Canais',
        endpoints: {
            '/api/series': 'Extrair dados da série. Parâmetro: url',
            '/api/debug': 'Debug - retorna HTML bruto',
            '/health': 'Verificar status da API'
        },
        exemplo: {
            url: '/api/series?url=https://redecanais.sh/browse-alice-in-borderland-videos-1-date.html'
        }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📡 Acesse: http://localhost:${PORT}`);
});
