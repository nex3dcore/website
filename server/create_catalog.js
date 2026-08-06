require('dotenv').config();
const { Paddle, Environment } = require('@paddle/paddle-node-sdk');
const fs = require('fs');
const path = require('path');

// Verify API key is present
const apiKey = process.env.PADDLE_API_KEY;
if (!apiKey || apiKey.includes('your_api_key')) {
    console.error("HATA: .env dosyasında geçerli bir PADDLE_API_KEY bulunamadı.");
    process.exit(1);
}

console.log("Paddle Sandbox kataloğu oluşturuluyor...");
console.log("Kullanılan API Key:", apiKey.substring(0, 20) + "...");

// Initialize Paddle Node SDK
const paddle = new Paddle(apiKey, {
    environment: Environment.sandbox
});

async function main() {
    try {
        // 1. Create Premium Pro Product
        console.log("1. Premium Pro ürünü oluşturuluyor...");
        const product = await paddle.products.create({
            name: 'Premium Pro',
            description: 'NexDesign BIM/CAD Geometri Editörü - Premium Pro Sürümü',
            taxCategory: 'saas'
        });
        console.log("Ürün başarıyla oluşturuldu! ID:", product.id);

        // 2. Create Monthly Price ($41.70)
        console.log("2. Aylık fiyat tanımlanıyor ($41.70/ay)...");
        const monthlyPrice = await paddle.prices.create({
            productId: product.id,
            description: 'Premium Pro Aylık Üyelik',
            name: 'Aylık Üyelik',
            billingCycle: {
                interval: 'month',
                frequency: 1
            },
            unitPrice: {
                amount: '4170', // $41.70 represented in cents
                currencyCode: 'USD'
            }
        });
        console.log("Aylık fiyat başarıyla oluşturuldu! ID:", monthlyPrice.id);

        // 3. Create Yearly Price ($417.00)
        console.log("3. Yıllık fiyat tanımlanıyor ($417.00/yıl)...");
        const yearlyPrice = await paddle.prices.create({
            productId: product.id,
            description: 'Premium Pro Yıllık Üyelik',
            name: 'Yıllık Üyelik',
            billingCycle: {
                interval: 'year',
                frequency: 1
            },
            unitPrice: {
                amount: '41700', // $417.00 represented in cents
                currencyCode: 'USD'
            }
        });
        console.log("Yıllık fiyat başarıyla oluşturuldu! ID:", yearlyPrice.id);

        // 4. Update Price IDs in account/index.html
        const htmlPath = path.join(__dirname, '..', 'account', 'index.html');
        console.log(`4. Fiyat kimlikleri ${htmlPath} dosyasına yazılıyor...`);

        if (!fs.existsSync(htmlPath)) {
            throw new Error(`account/index.html bulunamadı: ${htmlPath}`);
        }

        let htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // Replace monthly price ID placeholder
        htmlContent = htmlContent.replace('price_id_monthly_placeholder', monthlyPrice.id);
        // Replace yearly price ID placeholder
        htmlContent = htmlContent.replace('price_id_yearly_placeholder', yearlyPrice.id);

        fs.writeFileSync(htmlPath, htmlContent, 'utf8');
        console.log("HTML dosyası başarıyla güncellendi!");

        console.log("\n==============================================");
        console.log("TÜM İŞLEMLER BAŞARIYLA TAMAMLANDI!");
        console.log(`Ürün ID: ${product.id}`);
        console.log(`Aylık Fiyat ID: ${monthlyPrice.id}`);
        console.log(`Yıllık Fiyat ID: ${yearlyPrice.id}`);
        console.log("==============================================");

    } catch (err) {
        console.error("Paddle kataloğu oluşturulurken hata meydana geldi:", err.message);
        if (err.response) {
            console.error("Paddle API Yanıtı:", JSON.stringify(err.response, null, 2));
        }
        process.exit(1);
    }
}

main();
