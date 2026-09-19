import os
import re
import json

# Define replacements mapping
replacements = {
    # Brand names
    "AlwaysCodex Api'S": "Zyyvor API",
    "AlwaysCodex API": "Zyyvor API",
    "AlwaysCodex API'S": "Zyyvor API",
    "AlwaysCodex API": "Zyyvor API",
    "AlwaysCodex": "Zyyvor",
    "AlwaysCodex Api'S Platform": "Zyyvor API Platform",
    "AlwaysCodex REST API Platform": "Zyyvor API Platform",
    "AlwaysCodex REST API": "Zyyvor API",
    "AlwaysCodex Api'S Platform": "Zyyvor API Platform",
    "ALWAYSCODEX": "ZYYVOR",
    "ALWAYSCODEX": "ZYYVOR",
    
    # Domain replacements
    "api.zyvor.my.id": "api.zyvor.my.id",
    "api.alwayscodex.my.id": "api.zyvor.my.id",
    "am.alwayscodex.eu.cc": "am.zyvor.my.id",
    "gopay.alwayscodex.my.id": "gopay.zyvor.my.id",
    "alwayscodex.eu.cc": "zyvor.my.id",
    "alwayscodex.my.id": "zyvor.my.id",
    "alwayscodex": "zyvor",
    
    # Social/Contact
    "@AlwaysCodex404": "@ZyyvorAPI",
    "AlwaysCodex404": "ZyyvorAPI",
    "AlwaysCodex404": "ZyyvorAPI",
    
    # Branding text
    "AlwaysCodex API platform": "Zyyvor API platform",
    "AlwaysCodex API is a RESTful API service": "Zyyvor API is a RESTful API service",
    "AlwaysCodex API is a RESTful API": "Zyyvor API is a RESTful API",
    "AlwaysCodex API provides": "Zyyvor API provides",
    "AlwaysCodex API": "Zyyvor API",
    "AlwaysCodex": "Zyyvor",
    
    # Copyright
    "© 2026 AlwaysCodex": "© 2026 Zyyvor",
    "© 2025 AlwaysCodex": "© 2026 Zyyvor",
    "&copy; 2026 AlwaysCodex": "&copy; 2026 Zyyvor",
    "&copy; 2025 AlwaysCodex": "&copy; 2026 Zyyvor",
    
    # Titles and descriptions
    "AlwaysCodex API'S": "Zyyvor API",
    "AlwaysCodex API": "Zyyvor API",
    "AlwaysCodex REST API": "Zyyvor API",
    "AlwaysCodex Rest API": "Zyyvor API",
    "AlwaysCodex REST API Platform": "Zyyvor API Platform",
    
    # Meta descriptions
    "Free REST API platform with 300+ endpoints": "Free REST API platform with 400+ endpoints",
    "Free REST API platform with 400+ endpoints": "Free REST API platform with 400+ endpoints",
    "Free REST API platform with 400++ endpoints": "Free REST API platform with 400+ endpoints",
    
    # Telegram
    "t.me/AlwaysCodex404": "t.me/ZyyvorAPI",
    "@AlwaysCodex404": "@ZyyvorAPI",
    
    # JSON-LD schema
    "AlwaysCodex Api'S": "Zyyvor API",
    "AlwaysCodex REST API Platform": "Zyyvor API Platform",
    "AlwaysCodex Api'S Platform": "Zyyvor API Platform",
    
    # Social
    "@AlwaysCodex404": "@ZyyvorAPI",
    
    # Canonical URLs
    "https://api.zyvor.my.id": "https://api.zyvor.my.id",
    "https://api.alwayscodex.my.id": "https://api.zyvor.my.id",
    
    # Assets
    "api.zyvor.my.id/src/images/logo.jpg": "api.zyvor.my.id/src/images/logo.jpg",
    
    # Meta
    "AlwaysCodex Api'S Platform": "Zyyvor API Platform",
    "AlwaysCodex Rest API": "Zyyvor API",
}

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original = content
    
    # Apply replacements
    for old, new in replacements.items():
        content = content.replace(old, new)
    
    # Special case: title tag for index.html and docs.html - update to new branding
    # This is handled by the replacements above
    
    # Special case: Update meta description in index.html
    # Update title for docs.html - handled by replacements
    
    # Special: Update favicon references if needed
    # content = content.replace('href="/src/images/logo.ico"', 'href="/src/images/favicon.ico"')
    
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

# Process all HTML files in public directory (excluding backup)
public_dir = "/root/apiku/public"
count = 0
for root, dirs, files in os.walk("/root/apiku/public"):
    # Skip backup directory
    if "backup" in root:
        continue
    for file in files:
        if file.endswith(".html"):
            filepath = os.path.join(root, file)
            if process_file(filepath):
                print(f"Updated: {filepath}")
                count += 1

print(f"Updated {count} HTML files")
