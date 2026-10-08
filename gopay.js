const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

class GoMerchant {
    constructor() {
        this.baseUrl = 'https://api.gobiz.co.id';
        // OAuth prod untuk Direct Integration (client credentials)
        this.oauthUrl = 'https://accounts.go-jek.com';
        this.clientId = 'go-biz-web-new';
        this.appId = 'go-biz-web-dashboard';
        this.uniqueId = uuidv4();
        this._partnerToken = null;
        this._partnerTokenExpiresAt = 0;
    }

    headers(token = null) {
        const h = {
            'Accept': 'application/json, text/plain, */*',
            'Authentication-Type': 'go-id',
            'X-PhoneMake': 'Android 10',
            'X-PhoneModel': 'K',
            'x-DeviceOS': 'Web',
            'X-Platform': 'Web',
            'X-User-Type': 'merchant',
            'x-appId': this.appId,
            'x-uniqueid': this.uniqueId,
            'X-AppVersion': 'platform-v3.101.0-8918927d',
            'Gojek-Country-Code': 'ID',
            'Gojek-Timezone': 'Asia/Jakarta',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36'
        };
        if (token) h['Authorization'] = `Bearer ${token}`;
        return h;
    }

    convertCRC16(str) {
        let crc = 0xFFFF;
        const strlen = str.length;
        for (let c = 0; c < strlen; c++) {
            crc ^= str.charCodeAt(c) << 8;
            for (let i = 0; i < 8; i++) {
                if (crc & 0x8000) {
                    crc = (crc << 1) ^ 0x1021;
                } else {
                    crc = crc << 1;
                }
            }
        }
        let hex = crc & 0xFFFF;
        hex = ("000" + hex.toString(16).toUpperCase()).slice(-4);
        return hex;
    }

    async createDynamicQRIS(amount, staticQr) {
        try {
            let qrisData = staticQr;
            qrisData = qrisData.slice(0, -4);
            const step1 = qrisData.replace("010211", "010212");
            const step2 = step1.split("5802ID");
            const amountStr = amount.toString();
            let uang = "54" + ("0" + amountStr.length).slice(-2) + amountStr;
            uang += "5802ID";
            const result = step2[0] + uang + step2[1] + this.convertCRC16(step2[0] + uang + step2[1]);
            const qrCodeBuffer = await QRCode.toBuffer(result);
            return {
                qr_buffer: qrCodeBuffer,
                qr_string: result,
                amount: amount,
                created_at: new Date().toISOString()
            };
        } catch (error) {
            throw error;
        }
    }

    async requestOtp(phoneNumber) {
        const payload = {
            client_id: this.clientId,
            phone_number: phoneNumber,
            country_code: '62'
        };
        const response = await axios.post(`${this.baseUrl}/goid/login/request`, payload, {
            headers: this.headers()
        });
        return response.data;
    }

    async verifyOtp(otp, otpToken) {
        const payload = {
            client_id: this.clientId,
            data: {
                otp: otp,
                otp_token: otpToken
            },
            grant_type: 'otp'
        };
        const response = await axios.post(`${this.baseUrl}/goid/token`, payload, {
            headers: this.headers()
        });
        return response.data;
    }

    async refreshToken(refreshToken) {
        const payload = {
            client_id: this.clientId,
            grant_type: 'refresh_token',
            data: {
                refresh_token: refreshToken
            }
        };
        const response = await axios.post(`${this.baseUrl}/goid/token`, payload, {
            headers: this.headers()
        });
        return response.data;
    }

    async getMe(accessToken) {
        const response = await axios.get(`${this.baseUrl}/v1/users/me`, {
            headers: this.headers(accessToken)
        });
        return response.data;
    }

    async getMerchant(accessToken, merchantId) {
        const response = await axios.get(`${this.baseUrl}/v1/merchants/${merchantId}`, {
            headers: this.headers(accessToken)
        });
        return response.data;
    }

    // ============ OFFICIAL GoBiz Payment API (Direct Integration) ============
    // Auth: client_credentials di OAUTH_URL/oauth2/token → token dengan scope
    // payment:transaction:read + payment:transaction:write (bukan token OTP).

    // Ambil access token partner (di-cache sampai mendekati expiry).
    async getPartnerToken(clientId, clientSecret) {
        if (this._partnerToken && this._partnerTokenExpiresAt > Date.now() + 60000) {
            return this._partnerToken;
        }

        const payload = new URLSearchParams();
        payload.append('grant_type', 'client_credentials');
        payload.append('scope', 'payment:transaction:read payment:transaction:write');

        const resp = await axios.post(`${this.oauthUrl}/oauth2/token`, payload.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            auth: { username: clientId, password: clientSecret }
        });

        this._partnerToken = resp.data.access_token;
        this._partnerTokenExpiresAt = Date.now() + (resp.data.expires_in || 3600) * 1000;
        return this._partnerToken;
    }

    // POST /integrations/payment/outlets/{outlet_id}/v2/transactions
    async createQrisTransaction(outletId, { orderId, grossAmount, currency = 'IDR', itemDetails = [], customerDetails = null }, partnerToken) {
        const payload = {
            payment_type: 'qris',
            transaction_details: {
                order_id: orderId,
                gross_amount: grossAmount,
                currency
            }
        };
        if (itemDetails && itemDetails.length) payload.item_details = itemDetails;
        if (customerDetails) payload.customer_details = customerDetails;

        const idemKey = uuidv4().replace(/-/g, '').slice(0, 32);
        const response = await axios.post(
            `${this.baseUrl}/integrations/payment/outlets/${outletId}/v2/transactions`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${partnerToken}`,
                    'Idempotency-Key': idemKey
                }
            }
        );
        return response.data;
    }

    // GET /integrations/payment/outlets/{outlet_id}/v1/transactions/{id}
    async getQrisTransaction(outletId, transactionId, partnerToken) {
        const response = await axios.get(
            `${this.baseUrl}/integrations/payment/outlets/${outletId}/v1/transactions/${transactionId}`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${partnerToken}`
                }
            }
        );
        return response.data;
    }

    async getPayouts(accessToken) {
        const response = await axios.get(`${this.baseUrl}/v1/merchants/payouts?page=1&per=50`, {
            headers: this.headers(accessToken)
        });
        return response.data;
    }

    async getJournals(accessToken, merchantId, startTime = null) {
        const dateTo = new Date().toISOString();
        const dateFrom = startTime || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const payload = {
            from: 0,
            size: 50,
            sort: { time: { order: 'desc' } },
            included_categories: { incoming: ['transaction_share', 'action'] },
            query: [{
                clauses: [
                    { field: 'metadata.transaction.status', op: 'in', value: ['settlement', 'capture'] },
                    { field: 'metadata.transaction.transaction_time', op: 'gte', value: dateFrom },
                    { field: 'metadata.transaction.transaction_time', op: 'lte', value: dateTo },
                    { field: 'metadata.transaction.merchant_id', op: 'equal', value: merchantId }
                ],
                op: 'and'
            }]
        };
        const response = await axios.post(`${this.baseUrl}/journals/search`, payload, {
            headers: {
                ...this.headers(accessToken),
                'accept': 'application/vnd.journal.v1+json'
            }
        });
        return response.data;
    }
}

module.exports = GoMerchant;