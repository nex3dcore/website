require('dotenv').config();
const { Paddle, Environment } = require('@paddle/paddle-node-sdk');
const fs = require('fs');
const path = require('path');

const apiKey = process.env.PADDLE_API_KEY;
if (!apiKey || apiKey.includes('your_api_key')) {
    console.error("HATA: .env dosyasında geçerli bir PADDLE_API_KEY bulunamadı.");
    process.exit(1);
}

console.log("Paddle Sandbox Beta fiyatları tanımlanıyor...");

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

        // 1. Create Beta Monthly Price ($83.40)
        console.log("1. Beta Aylık fiyat tanımlanıyor ($83.40/ay)...");
        const betaMonthlyPrice = await paddle.prices.create({
            productId: productId,
            description: 'Premium Pro Beta Aylık Üyelik (%40 İndirimli)',
            name: 'Beta Aylık Üyelik',
            billingCycle: {
                interval: 'month',
                frequency: 1
            },
            unitPrice: {
                amount: '8340', // $83.40 in cents
                currencyCode: 'USD'
            }
        });
        console.log("Beta aylık fiyat başarıyla oluşturuldu! ID:", betaMonthlyPrice.id);

        // 2. Create Beta Yearly Price ($834.00)
        console.log("2. Beta Yıllık fiyat tanımlanıyor ($834.00/yıl)...");
        const betaYearlyPrice = await paddle.prices.create({
            productId: productId,
            description: 'Premium Pro Beta Yıllık Üyelik (%40 İndirimli)',
            name: 'Beta Yıllık Üyelik',
            billingCycle: {
                interval: 'year',
                frequency: 1
            },
            unitPrice: {
                amount: '83400', // $834.00 in cents
                currencyCode: 'USD'
            }
        });
        console.log("Beta yıllık fiyat başarıyla oluşturuldu! ID:", betaYearlyPrice.id);

        // 3. Update Price IDs in account/index.html
        const htmlPath = path.join(__dirname, '..', 'account', 'index.html');
        console.log(`3. Fiyat kimlikleri ${htmlPath} dosyasına yazılıyor...`);

        if (fs.existsSync(htmlPath)) {
            let htmlContent = fs.readFileSync(htmlPath, 'utf8');

            // Replace monthly placeholder
            htmlContent = htmlContent.replace('pri_01kymonthly_placeholder', betaMonthlyPrice.id);
            // Replace yearly placeholder
            htmlContent = htmlContent.replace('pri_01kyyearly_placeholder', betaYearlyPrice.id);

            fs.writeFileSync(htmlPath, htmlContent, 'utf8');
            console.log("HTML dosyası başarıyla güncellendi!");
        } else {
            console.warn(`Uyarı: ${htmlPath} bulunamadı.`);
        }

        console.log("\n==============================================");
        console.log("BETA FİYATLARI BAŞARIYLA OLUŞTURULDU!");
        console.log(`Aylık Fiyat ID: ${betaMonthlyPrice.id}`);
        console.log(`Yıllık Fiyat ID: ${betaYearlyPrice.id}`);
        console.log("==============================================");

    } catch (err) {
        console.error("Beta fiyatları oluşturulurken hata:", err.message);
        if (err.response) {
            console.error("Paddle API Response:", JSON.stringify(err.response, null, 2));
        }
    }
}

main();
