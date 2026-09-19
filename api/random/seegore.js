/**
 * Random Seegore API - Get random gore content from Seegore
 * 
 * GET /api/randomseegore
 * 
 * result: 
 * - JSON response dengan random gore content beserta detail video
 */

import axios from "axios";
import * as cheerio from "cheerio";
import logger from "../../src/utils/logger.js";

// ==================== Type Definitions ====================
/**
 * @typedef {Object} LinkData
 * @property {string} title
 * @property {string} link
 * @property {string|undefined} thumb
 * @property {string} view
 * @property {string} vote
 * @property {string} tag
 * @property {string} comment
 */

/**
 * @typedef {Object} DetailedData
 * @property {string} title
 * @property {string} source
 * @property {string|undefined} thumb
 * @property {string} tag
 * @property {string} upload
 * @property {string} author
 * @property {string} comment
 * @property {string} vote
 * @property {string} view
 * @property {string|undefined} video1
 * @property {string|undefined} video2
 */

// ==================== Seegore Client ====================
class SeegoreClient {
    /**
     * Fetch detailed data from individual post page
     * @param {LinkData} linkData - Basic link data from listing
     * @returns {Promise<DetailedData>}
     */
    async fetchDetailedData(linkData) {
        try {
            logger.info(`[SEEGORE] Fetching details from: ${linkData.link.substring(0, 50)}...`);
            
            const res = await axios({
                method: 'get',
                url: linkData.link,
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(res.data);
            
            // Extract detailed data
            const detailed = {
                title: linkData.title,
                source: linkData.link,
                thumb: linkData.thumb,
                tag: $("div.site-main > div > header > div > div > p").text().trim(),
                upload: $("div.site-main")
                    .find("span.auth-posted-on > time:nth-child(2)")
                    .text()
                    .trim(),
                author: $("div.site-main").find("span.auth-name.mf-hide > a").text().trim(),
                comment: linkData.comment,
                vote: linkData.vote,
                view: $("div.site-main")
                    .find("span.post-meta-item.post-views.s-post-views.size-lg > span.count")
                    .text()
                    .trim(),
                video1: $("div.site-main").find("video > source").attr("src"),
                video2: $("div.site-main").find("video > a").attr("href")
            };

            logger.info(`[SEEGORE] Details fetched successfully for: ${detailed.title.substring(0, 30)}...`);
            
            return detailed;

        } catch (error) {
            logger.error(`[SEEGORE] Fetch detailed error: ${error.message}`);
            throw new Error(`Fetching detailed data failed: ${error.message}`);
        }
    }

    /**
     * Scrape random content from Seegore
     * @returns {Promise<DetailedData>}
     */
    async getRandomContent() {
        try {
            // Random page between 0 and 227
            const page = Math.floor(Math.random() * 228);
            logger.info(`[SEEGORE] Scraping page: ${page}`);
            
            // Fetch listing page
            const res = await axios({
                method: 'get',
                url: `https://seegore.com/gore/page/${page}`,
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(res.data);
            
            // Extract links from articles
            const links = $("ul > li > article").map((i, el) => ({
                title: $(el).find("div.content > header > h2").text().trim(),
                link: $(el).find("div.post-thumbnail > a").attr("href") || "",
                thumb: $(el).find("div.post-thumbnail > a > div > img").attr("src"),
                view: $(el)
                    .find("div.post-thumbnail > div.post-meta.bb-post-meta.post-meta-bg > span.post-meta-item.post-views")
                    .text()
                    .trim(),
                vote: $(el)
                    .find("div.post-thumbnail > div.post-meta.bb-post-meta.post-meta-bg > span.post-meta-item.post-votes")
                    .text()
                    .trim(),
                tag: $(el).find("div.content > header > div > div.bb-cat-links").text().trim(),
                comment: $(el)
                    .find("div.content > header > div > div.post-meta.bb-post-meta > a")
                    .text()
                    .trim()
            })).get();

            if (links.length === 0) {
                throw new Error("No links found on the scraped page.");
            }

            logger.info(`[SEEGORE] Found ${links.length} items on page ${page}`);

            // Select random link
            const randomIndex = Math.floor(Math.random() * links.length);
            const randomLink = links[randomIndex];
            
            logger.info(`[SEEGORE] Selected random item #${randomIndex}: "${randomLink.title.substring(0, 30)}..."`);

            // Fetch detailed data
            const detailedData = await this.fetchDetailedData(randomLink);

            return {
                success: true,
                data: detailedData,
                metadata: {
                    page: page,
                    total_items: links.length,
                    selected_index: randomIndex
                }
            };

        } catch (error) {
            logger.error(`[SEEGORE] Scraping error: ${error.message}`);
            
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
    name: "Random Seegore",
    description: "Get random gore content from Seegore (Warning: Graphic Content)",
    category: "Random",
    methods: ["GET"],
    params: [],

    paramsSchema: {},

    async run(req, res) {
        const client = new SeegoreClient();
        
        try {
            /* =======================================
               RANDOM SEEGORE PROCESS
            ======================================= */

            // Get random content
            const result = await client.getRandomContent();

            if (!result.success || !result.data) {
                throw new Error("Gagal mendapatkan konten dari Seegore");
            }

            // Log success
            logger.info(
                `[SEEGORE] Success | ip=${req.ip} | ` +
                `page=${result.metadata.page} | ` +
                `title="${result.data.title.substring(0, 30)}..." | ` +
                `has_video=${result.data.video1 ? 'yes' : 'no'}`
            );

            // Set headers
            res.setHeader("Content-Type", "application/json");
            res.setHeader("X-Page", result.metadata.page);
            res.setHeader("X-Total-Items", result.metadata.total_items);
            res.setHeader("X-Selected-Index", result.metadata.selected_index);
            res.setHeader("X-Title", encodeURIComponent(result.data.title));
            res.setHeader("X-Has-Video", result.data.video1 ? 'true' : 'false');
            
            // NO CACHE HEADERS
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            res.setHeader("Surrogate-Control", "no-store");
            
            // Add warning header for graphic content
            res.setHeader("X-Content-Warning", "Graphic content may be disturbing");
            
            // Return JSON response
            return res.json({
                status: true,
                result: result.data
            });

        } catch (err) {
            // Detailed error logging
            logger.error(
                `[SEEGORE] Error | ip=${req.ip} | ` +
                `message=${err.message} | code=${err.code || 'N/A'}`
            );
            
            // Check specific errors
            if (err.message.includes("No links found")) {
                return res.status(404).json({
                    status: false,
                    message: "Tidak ada konten ditemukan pada halaman tersebut",
                    code: "NO_CONTENT_FOUND"
                });
            }
            
            if (err.message.includes("Fetching detailed data failed")) {
                return res.status(502).json({
                    status: false,
                    message: "Gagal mengambil detail konten",
                    code: "DETAIL_FETCH_FAILED"
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
                    message: "Timeout mengambil data dari Seegore",
                    code: "TIMEOUT"
                });
            }
            
            return res.status(500).json({
                status: false,
                message: err.message || "Gagal mendapatkan konten random dari Seegore",
                code: "INTERNAL_ERROR"
            });
        }
    },
};