import axios from "axios";
import crypto from "crypto";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Alight Motion Premium Service
 * API: am-premiumms.ai.studio
 */
class AlightMotionService {
  constructor() {
    this.BASE_URL = "https://am-premiumms.ai.studio";

    this.HEADERS = {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*"
    };

    this.client = axios.create({
      baseURL: this.BASE_URL,
      headers: this.HEADERS,
      timeout: 35000,
      validateStatus: () => true
    });
  }

  /**
   * Generate code order (GPA.xxxx.xxxx.xxxx.xxxxx)
   */
  generateCodeOrder() {
    const r = (len) => {
      let str = "";
      for (let i = 0; i < len; i++) str += crypto.randomInt(0, 10);
      return str;
    };
    return `GPA.${r(4)}.${r(4)}.${r(4)}.${r(5)}`;
  }

  /**
   * Send Magic Link
   * POST /api/send-link
   */
  async sendMagicLink(email) {
    const maxAttempts = 3;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.client.post("/api/send-link", {
          email: email.trim()
        });

        const data = response.data;
        if (response.status === 200 && (data?.success || data?.status)) {
          return {
            success: true,
            message: data?.message || "Link berhasil dikirim.",
            data
          };
        }

        // Retry if 403 or 429
        if (response.status === 403 || response.status === 429) {
          lastErr = new Error(typeof data === "string" ? `HTTP ${response.status}` : (data?.message || `HTTP ${response.status}`));
          if (attempt < maxAttempts) {
            await sleep(2500 * attempt);
            continue;
          }
        }

        return {
          success: false,
          error: data?.message || typeof data === "string" ? data : `HTTP ${response.status}`,
          data
        };
      } catch (error) {
        lastErr = error;
        if (attempt < maxAttempts) {
          await sleep(2000 * attempt);
          continue;
        }
      }
    }

    return {
      success: false,
      error: lastErr?.message || "Gagal mengirim magic link setelah beberapa percobaan."
    };
  }

  /**
   * Verify Magic Link & Activate Alight Motion VIP
   * POST /api/verify-link
   */
  async verifyMagicLink(email, magicLink) {
    const maxAttempts = 3;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.client.post("/api/verify-link", {
          email: email.trim(),
          magicLink: magicLink.trim()
        });

        const data = response.data;
        const isSuccess = response.status === 200 && (data?.success || data?.status);

        if (!isSuccess) {
          if ((response.status === 403 || response.status === 429) && attempt < maxAttempts) {
            await sleep(2500 * attempt);
            continue;
          }

          return {
            success: false,
            message: data?.message || "Verifikasi gagal.",
            data
          };
        }

        const user = data.data || data.userData || {};

        return {
          success: true,
          message: data.message || "Verifikasi berhasil, Alight Motion Premium VIP aktif 1 Tahun!",
          idToken: user.idToken || null,
          refreshToken: user.refreshToken || null,
          orderId: user.orderId || null,
          user: {
            email: user.email || email,
            uid: user.uid || user.id || null,
            status: user.status || "ACTIVE",
            membershipStatus: user.membershipStatus || "PREMIUM_ACTIVE",
            tier: user.tier || user.planName || "Alight Motion Pro VIP",
            orderId: user.orderId || null,
            validUntil: user.validUntil || null,
            idToken: user.idToken || null,
            refreshToken: user.refreshToken || null
          },
          data: user
        };
      } catch (error) {
        lastErr = error;
        if (attempt < maxAttempts) {
          await sleep(2000 * attempt);
          continue;
        }
      }
    }

    return {
      success: false,
      error: lastErr?.message || "Verifikasi gagal setelah beberapa percobaan."
    };
  }

  /**
   * Verify and fetch profile (Compatibility alias)
   */
  async verifyAndFetchProfile(email, rawLink) {
    return this.verifyMagicLink(email, rawLink);
  }

  /**
   * Apply Premium (Compatibility method)
   */
  async applyPremium(idToken, customCodeOrder = null) {
    return {
      success: true,
      message: "Premium VIP aktif melalui verifikasi magic link",
      codeorder: customCodeOrder || this.generateCodeOrder()
    };
  }

  /**
   * Error handler
   */
  handleError(error) {
    const responseData = error.response?.data;
    return {
      success: false,
      error: responseData || error.message,
      message: responseData?.message || error.message || "Request gagal."
    };
  }
}

const amService = new AlightMotionService();

export default amService;
