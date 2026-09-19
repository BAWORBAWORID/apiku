/**
 * Random Anime Quotes API - Get random anime quotes from OtakOtaku
 * 
 * GET /api/animequotes
 * 
 * result: 
 * - JSON response dengan random quote anime
 */

import axios from "axios";
import * as cheerio from "cheerio";
import logger from "../../src/utils/logger.js";

// ==================== Anime Quotes Client ====================
class AnimeQuotesClient {
    async getRandomQuotes() {
        try {
            // Random page between 0 and 183
            const page = Math.floor(Math.random() * 184);
            logger.info(`[ANIMEQUOTES] Fetching from page: ${page}`);
            
            // Fetch quotes page
            const { data } = await axios({
                method: 'get',
                url: `https://otakotaku.com/quote/feed/${page}`,
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            // Parse with cheerio
            const $ = cheerio.load(data);
            const quotes = [];

            $("div.kotodama-list").each(function (index, element) {
                quotes.push({
                    link: $(element).find("a").attr("href") || null,
                    gambar: $(element).find("img").attr("data-src") || null,
                    karakter: $(element).find("div.char-name").text().trim(),
                    anime: $(element).find("div.anime-title").text().trim(),
                    episode: $(element).find("div.meta").first().text().trim(),
                    up_at: $(element).find("small.meta").text().trim(),
                    quotes: $(element).find("div.quote").text().trim()
                });
            });

            if (quotes.length === 0) {
                throw new Error("No quotes found for the given page.");
            }

            // Get random quote from the list
            const randomIndex = Math.floor(Math.random() * quotes.length);
            const randomQuote = quotes[randomIndex];

            logger.info(
                `[ANIMEQUOTES] Success | ` +
                `page=${page} | ` +
                `total_quotes=${quotes.length} | ` +
                `selected=${randomIndex} | ` +
                `anime="${randomQuote.anime}" | ` +
                `character="${randomQuote.karakter}"`
            );

            return {
                success: true,
                data: randomQuote,
                metadata: {
                    page: page,
                    total: quotes.length,
                    selected: randomIndex
                }
            };

        } catch (error) {
            logger.error(`[ANIMEQUOTES] Error: ${error.message}`);
            
            if (error.response) {
                const detail = error.response.data?.toString() || 'Unknown error';
                throw new Error(`API ERROR: ${detail.substring(0, 200)}`);
            }
            
            throw error;
        }
    }
}

// ==================== MAIN ENDPOINT ====================
export default {
    name: "Random Anime Quotes",
    description: "Get random anime quotes from OtakOtaku",
    category: "Random",
    methods: ["GET"],
    params: [],

    paramsSchema: {},

    async run(req, res) {
        const client = new AnimeQuotesClient();
        
        try {
            /* =======================================
               RANDOM ANIME QUOTES PROCESS
            ======================================= */

            // Get random anime quote
            const result = await client.getRandomQuotes();

            if (!result.success || !result.data) {
                throw new Error("Gagal mendapatkan quotes anime");
            }

            // Log success
            logger.info(
                `[ANIMEQUOTES] Success | ip=${req.ip} | ` +
                `page=${result.metadata.page} | ` +
                `anime="${result.data.anime}"`
            );

            // Set headers - NO CACHE
            res.setHeader("Content-Type", "application/json");
            res.setHeader("X-Page", result.metadata.page);
            res.setHeader("X-Total-Quotes", result.metadata.total);
            res.setHeader("X-Selected-Index", result.metadata.selected);
            res.setHeader("X-Anime", encodeURIComponent(result.data.anime));
            res.setHeader("X-Character", encodeURIComponent(result.data.karakter));
            
            // NO CACHE HEADERS
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            res.setHeader("Surrogate-Control", "no-store");
            
            // Return JSON response
            return res.json({
                status: true,
                result: result.data
            });

        } catch (err) {
            // Detailed error logging
            logger.error(
                `[ANIMEQUOTES] Error | ip=${req.ip} | ` +
                `message=${err.message} | code=${err.code || 'N/A'}`
            );
            
            // Check specific errors
            if (err.message.includes("No quotes found")) {
                return res.status(404).json({
                    status: false,
                    message: "Tidak ada quotes ditemukan untuk halaman tersebut",
                    code: "NO_QUOTES_FOUND"
                });
            }
            
            if (err.message.includes("API ERROR")) {
                return res.status(502).json({
                    status: false,
                    message: err.message,
                    code: "API_ERROR"
                });
            }
            
            if (err.code === "ECONNABORTED") {
                return res.status(504).json({
                    status: false,
                    message: "Timeout mengambil data dari API",
                    code: "TIMEOUT"
                });
            }
            
            return res.status(500).json({
                status: false,
                message: err.message || "Gagal mendapatkan quotes anime random",
                code: "INTERNAL_ERROR"
            });
        }
    },
};