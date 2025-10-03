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
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        
        const seriesData = {
            title: '',
            seasons: []
        };

        // Extrair título da série (do nome do arquivo da imagem)
        const imageSrc = $('img').first().attr('src');
        if (imageSrc) {
            const titleMatch = imageSrc.match(/\/([^\/]+)%20Capa\.jpg/);
            if (titleMatch) {
                seriesData.title = decodeURIComponent(titleMatch[1]).replace(/%20/g, ' ');
            }
        }

        let currentSeason = null;

        // Processar cada elemento
        $('p').each((index, element) => {
            const $element = $(element);
            
            // Verificar se é um título de temporada
            const seasonTitle = $element.find('span[style*="font-size: x-large"] strong').first().text().trim();
            if (seasonTitle) {
                if (currentSeason) {
                    seriesData.seasons.push(currentSeason);
                }
                
                currentSeason = {
                    season: seasonTitle,
                    episodes: []
                };
                return;
            }

            // Verificar se é um episódio
            const episodeText = $element.text().trim();
            if (episodeText.includes('Episódio') && currentSeason) {
                const episodeData = extractEpisodeData($element);
                if (episodeData) {
                    currentSeason.episodes.push(episodeData);
                }
            }
        });

        // Adicionar a última temporada
        if (currentSeason) {
            seriesData.seasons.push(currentSeason);
        }

        return seriesData;
    } catch (error) {
        console.error('Erro ao extrair dados:', error);
        throw new Error('Erro ao extrair dados da série');
    }
}

// Função para extrair dados de um episódio
function extractEpisodeData($element) {
    const episodeData = {
        episode: '',
        title: '',
        links: {}
    };

    // Extrair número e título do episódio
    const episodeText = $element.text().trim();
    const episodeMatch = episodeText.match(/Episódio\s+(\d+)\s*-\s*(.*?)(?=\s*(Dublado|Legendado|Assistir)|$)/);
    
    if (episodeMatch) {
        episodeData.episode = `Episódio ${episodeMatch[1]}`;
        episodeData.title = episodeMatch[2].trim();
        
        // Limpar o título (remover traços extras)
        if (episodeData.title.startsWith('-')) {
            episodeData.title = episodeData.title.substring(1).trim();
        }
        if (episodeData.title === '-') {
            episodeData.title = '';
        }
    }

    // Extrair links
    $element.find('a').each((i, link) => {
        const $link = $(link);
        const href = $link.attr('href');
        const text = $link.text().trim();
        
        if (href) {
            const fullUrl = `https://redecanais.sh${href}`;
            
            if (text === 'Assistir') {
                episodeData.links.assistir = fullUrl;
            } else if (text === 'Dublado') {
                episodeData.links.dublado = fullUrl;
            } else if (text === 'Legendado') {
                episodeData.links.legendado = fullUrl;
            }
        }
    });

    return Object.keys(episodeData.links).length > 0 ? episodeData : null;
}

// Endpoint principal
app.get('/api/series', async (req, res) => {
    const { url } = req.query;

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
            data: seriesData
        });

    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint de saúde
app.get('/health', (req, res) => {
    res.json({ status: 'API funcionando', timestamp: new Date().toISOString() });
});

// Rota raiz
app.get('/', (req, res) => {
    res.json({
        message: 'API de Extração de Séries - Rede Canais',
        endpoints: {
            '/api/series': 'Extrair dados da série. Parâmetro: url',
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
