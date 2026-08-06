require('dotenv').config();
const { Paddle, Environment } = require('@paddle/paddle-node-sdk');
const fs = require('fs');
const path = require('path');

const apiKey = process.env.PADDLE_API_KEY;
if (!apiKey || apiKey.includes('your_api_key')) {
    console.error("HATA: .env dosyasında geçerli bir PADDLE_API_KEY bulunamadı.");
    process.exit(1);
}

console.log("Paddle Sandbox Standart fiyatları tanımlanıyor...");

const paddle = new Paddle(apiKey, {
    environment: Environment.sandbox
});

// Retrieve the existing Alpha monthly price ID to find the product ID
const alphaMonthlyPriceId = 'pri_01kxhzcvcktvh9984ff3tfgnqy';

async function main() {
    try {
        console.log(`Mevcut fiyat ${alphaMonthlyPriceId} üzerinden ürün ID'si çözümleniyor...`);
        const alphaPrice = await paddle.prices.get(alphaMonthlyPriceId);
        const productId = alphaPrice.productId;
        console.log(`Ürün ID'si çözümlendi: ${productId}`);

        // 1. Create Standard Monthly Price ($139.00)
        console.log("1. Standart Aylık fiyat tanımlanıyor ($139.00/ay)...");
        const standardMonthlyPrice = await paddle.prices.create({
            productId: productId,
            description: 'Premium Pro Standart Aylık Üyelik',
            name: 'Standart Aylık Üyelik',
            billingCycle: {
                interval: 'month',
                frequency: 1
            },
            unitPrice: {
                amount: '13900', // $139.00 in cents
                currencyCode: 'USD'
            }
        });
        console.log("Standart aylık fiyat başarıyla oluşturuldu! ID:", standardMonthlyPrice.id);

        // 2. Create Standard Yearly Price ($1390.00)
        console.log("2. Standart Yıllık fiyat tanımlanıyor ($1390.00/yıl)...");
        const standardYearlyPrice = await paddle.prices.create({
            productId: productId,
            description: 'Premium Pro Standart Yıllık Üyelik',
            name: 'Standart Yıllık Üyelik',
            billingCycle: {
                interval: 'year',
                frequency: 1
            },
            unitPrice: {
                amount: '139000', // $1390.00 in cents
                currencyCode: 'USD'
            }
        });
        console.log("Standart yıllık fiyat başarıyla oluşturuldu! ID:", standardYearlyPrice.id);

        // 3. Update Price IDs in account/index.html
        const htmlPath = path.join(__dirname, '..', 'account', 'index.html');
        console.log(`3. Fiyat kimlikleri ${htmlPath} dosyasına yazılıyor...`);

        if (fs.existsSync(htmlPath)) {
            let htmlContent = fs.readFileSync(htmlPath, 'utf8');

            // Replace standard monthly placeholder
            htmlContent = htmlContent.replace('pri_01kystandardmonthly_placeholder', standardMonthlyPrice.id);
            // Replace standard yearly placeholder
            htmlContent = htmlContent.replace('pri_01kystandardyearly_placeholder', standardYearlyPrice.id);

            fs.writeFileSync(htmlPath, htmlContent, 'utf8');
            console.log("HTML dosyası başarıyla güncellendi!");
        } else {
            console.warn(`Uyarı: ${htmlPath} bulunamadı.`);
        }

        console.log("\n==============================================");
        console.log("STANDART FİYATLARI BAŞARIYLA OLUŞTURULDU!");
        console.log(`Standart Aylık Fiyat ID: ${standardMonthlyPrice.id}`);
        console.log(`Standart Yıllık Fiyat ID: ${standardYearlyPrice.id}`);
        console.log("==============================================");

    } catch (err) {
        console.error("Standart fiyatlar oluşturulurken hata:", err.message);
        if (err.response) {
            console.error("Paddle API Response:", JSON.stringify(err.response, null, 2));
        }
    }
}

main();
