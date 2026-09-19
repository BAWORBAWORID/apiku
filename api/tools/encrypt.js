// =====================
// SIMPLE ENCRYPT/DECRYPT TOOLS
// =====================

// =====================
// TEXT TO BINARY
// =====================
function textToBinary(text) {
    return text.split('').map(char => {
        return char.charCodeAt(0).toString(2).padStart(8, '0');
    }).join(' ');
}

// =====================
// BINARY TO TEXT
// =====================
function binaryToText(binary) {
    return binary.split(' ').map(bin => {
        return String.fromCharCode(parseInt(bin, 2));
    }).join('');
}

// =====================
// TEXT TO BASE32
// =====================
function textToBase32(text) {
    const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    let base32 = '';
    
    // Ubah text ke binary string
    for (let i = 0; i < text.length; i++) {
        bits += text.charCodeAt(i).toString(2).padStart(8, '0');
    }
    
    // Tambah padding jika perlu
    while (bits.length % 5 !== 0) bits += '0';
    
    // Konversi per 5 bit ke base32
    for (let i = 0; i < bits.length; i += 5) {
        const chunk = bits.substr(i, 5);
        const index = parseInt(chunk, 2);
        base32 += base32chars[index];
    }
    
    // Tambah padding =
    while (base32.length % 8 !== 0) base32 += '=';
    
    return base32;
}

// =====================
// BASE32 TO TEXT
// =====================
function base32ToText(base32) {
    const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    base32 = base32.replace(/=/g, '');
    
    let bits = '';
    
    // Ubah base32 ke binary
    for (let i = 0; i < base32.length; i++) {
        const index = base32chars.indexOf(base32[i]);
        bits += index.toString(2).padStart(5, '0');
    }
    
    // Konversi binary ke text (8 bit per karakter)
    let text = '';
    for (let i = 0; i < bits.length; i += 8) {
        const byte = bits.substr(i, 8);
        if (byte.length === 8) {
            text += String.fromCharCode(parseInt(byte, 2));
        }
    }
    
    return text;
}

// =====================
// TEXT TO BASE64
// =====================
function textToBase64(text) {
    return Buffer.from(text).toString('base64');
}

// =====================
// BASE64 TO TEXT
// =====================
function base64ToText(base64) {
    return Buffer.from(base64, 'base64').toString('utf-8');
}

// =====================
// TEXT TO HEX
// =====================
function textToHex(text) {
    return text.split('').map(char => {
        return char.charCodeAt(0).toString(16).padStart(2, '0');
    }).join(' ');
}

// =====================
// HEX TO TEXT
// =====================
function hexToText(hex) {
    return hex.split(' ').map(h => {
        return String.fromCharCode(parseInt(h, 16));
    }).join('');
}

// =====================
// TEXT TO OCTAL
// =====================
function textToOctal(text) {
    return text.split('').map(char => {
        return char.charCodeAt(0).toString(8).padStart(3, '0');
    }).join(' ');
}

// =====================
// OCTAL TO TEXT
// =====================
function octalToText(octal) {
    return octal.split(' ').map(oct => {
        return String.fromCharCode(parseInt(oct, 8));
    }).join('');
}

// =====================
// ROT13 (Caesar Cipher)
// =====================
function rot13(text) {
    return text.replace(/[a-zA-Z]/g, function(char) {
        const start = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(start + (char.charCodeAt(0) - start + 13) % 26);
    });
}

// =====================
// ATMUR (ROT13 Kebalikan)
// =====================
function atmur(text) {
    return rot13(text); // ROT13 kebalikannya ya ROT13 juga
}

// =====================
// ATBASH Cipher
// =====================
function atbash(text) {
    return text.replace(/[a-zA-Z]/g, function(char) {
        const isUpper = char <= 'Z';
        const a = isUpper ? 65 : 97;
        const z = isUpper ? 90 : 122;
        return String.fromCharCode(z - (char.charCodeAt(0) - a));
    });
}

// =====================
// MAIN FUNCTION
// =====================
function encryptDecrypt(text, mode = 'encrypt', method = 'base64') {
    if (!text) {
        return { error: 'Text is required' };
    }
    
    const methods = {
        // ENCRYPT METHODS
        base64: {
            encrypt: (t) => textToBase64(t),
            decrypt: (t) => base64ToText(t)
        },
        base32: {
            encrypt: (t) => textToBase32(t),
            decrypt: (t) => base32ToText(t)
        },
        binary: {
            encrypt: (t) => textToBinary(t),
            decrypt: (t) => binaryToText(t)
        },
        hex: {
            encrypt: (t) => textToHex(t),
            decrypt: (t) => hexToText(t)
        },
        octal: {
            encrypt: (t) => textToOctal(t),
            decrypt: (t) => octalToText(t)
        },
        rot13: {
            encrypt: (t) => rot13(t),
            decrypt: (t) => rot13(t) // ROT13 sama untuk encrypt/decrypt
        },
        atbash: {
            encrypt: (t) => atbash(t),
            decrypt: (t) => atbash(t) // Atbash juga sama
        }
    };
    
    // Cek method valid
    if (!methods[method]) {
        return { 
            error: `Method '${method}' not found. Available: ${Object.keys(methods).join(', ')}` 
        };
    }
    
    // Cek mode valid
    if (!['encrypt', 'decrypt'].includes(mode)) {
        return { error: "Mode must be 'encrypt' or 'decrypt'" };
    }
    
    try {
        const result = methods[method][mode](text);
        
        return {
            success: true,
            input: text,
            mode: mode,
            method: method,
            output: result,
            length: {
                input: text.length,
                output: result.length
            }
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            input: text,
            mode: mode,
            method: method
        };
    }
}

/*
// =====================
// EXAMPLE USAGE
// =====================
console.log("=== SIMPLE ENCRYPT/DECRYPT TOOLS ===\n");

// Contoh 1: Base64
console.log("1. BASE64:");
console.log(encryptDecrypt("Hello World", "encrypt", "base64"));
console.log(encryptDecrypt("SGVsbG8gV29ybGQ=", "decrypt", "base64"));
console.log();

// Contoh 2: Binary
console.log("2. BINARY:");
console.log(encryptDecrypt("Hello", "encrypt", "binary"));
console.log(encryptDecrypt("01001000 01100101 01101100 01101100 01101111", "decrypt", "binary"));
console.log();

// Contoh 3: Base32
console.log("3. BASE32:");
console.log(encryptDecrypt("Hello", "encrypt", "base32"));
console.log(encryptDecrypt("JBSWY3DP", "decrypt", "base32"));
console.log();

// Contoh 4: Hex
console.log("4. HEX:");
console.log(encryptDecrypt("Hello", "encrypt", "hex"));
console.log(encryptDecrypt("48 65 6c 6c 6f", "decrypt", "hex"));
console.log();

// Contoh 5: Octal
console.log("5. OCTAL:");
console.log(encryptDecrypt("Hello", "encrypt", "octal"));
console.log(encryptDecrypt("110 145 154 154 157", "decrypt", "octal"));
console.log();

// Contoh 6: ROT13
console.log("6. ROT13:");
console.log(encryptDecrypt("Hello World", "encrypt", "rot13"));
console.log(encryptDecrypt("Uryyb Jbeyq", "decrypt", "rot13"));
console.log();

// Contoh 7: Atbash
console.log("7. ATBASH:");
console.log(encryptDecrypt("Hello", "encrypt", "atbash"));
console.log(encryptDecrypt("Svool", "decrypt", "atbash"));
*/

// =====================
// EXPORT FUNCTION
// =====================
export default {
    name: "Simple Encrypt/Decrypt Tools",
    description: "Convert text using various encryption methods (no key needed)",
    category: "Tools",
    methods: ["GET", "POST"],
    
    params: ["text", "mode", "method"],
    
    paramsSchema: {
        text: {
            type: "string",
            required: true,
            description: "Text to encrypt or decrypt"
        },
        mode: {
            type: "string",
            required: false,
            enum: ["encrypt", "decrypt"],
            default: "encrypt",
            description: "Action mode"
        },
        method: {
            type: "string",
            required: false,
            enum: ["base64", "base32", "binary", "hex", "octal", "rot13", "atbash"],
            default: "base64",
            description: "Encryption method"
        }
    },
    
    run(req, res) {
        try {
            const { 
                text, 
                mode = "encrypt", 
                method = "base64" 
            } = req.query;
            
            if (!text) {
                return res.status(400).json({
                    status: false,
                    error: "Parameter 'text' is required"
                });
            }
            
            const result = encryptDecrypt(text, mode, method);
            
            if (!result.success) {
                return res.status(400).json(result);
            }
            
            return res.json({
                status: true,
                ...result
            });
            
        } catch (error) {
            return res.status(500).json({
                status: false,
                error: error.message
            });
        }
    }
};