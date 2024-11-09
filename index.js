import OpenAI from "openai";
import dotenv from "dotenv";
import sharp from "sharp";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function processAndConvertImage(imagePath) {
  try {
    const processedImageBuffer = await sharp(imagePath)
      .jpeg({
        quality: 80,
        mozjpeg: true,
      })
      .resize(1024, 1024, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer();

    return processedImageBuffer.toString("base64");
  } catch (error) {
    console.error("Erreur lors du traitement de l'image:", error);
    throw error;
  }
}

async function analyzeImageWithAssistant(imagePath) {
  try {
    const imageBase64 = await processAndConvertImage(imagePath);
    
    // Créer un thread
    const thread = await client.beta.threads.create();
    
    // Ajouter le message avec l'image
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: [
        { type: "text", text: "Analyze this image json and answer in French" },
        { type: "image_url", image_url: {
            url: `https://fatsecretfrance.fr/wp-content/uploads/2021/12/fatsecretfrance_245977340_4271925992855989_4004333819651907264_n.jpg.webp`,
        } },
        
      ],
      
    });

    // Créer et attendre le run
    const run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.ASSISTANT_ID,
    });

    // Attendre que le run soit terminé
    let runStatus = await client.beta.threads.runs.retrieve(thread.id, run.id);
    while (runStatus.status !== "completed") {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await client.beta.threads.runs.retrieve(thread.id, run.id);
      
      if (runStatus.status === "failed") {
        throw new Error("Run failed: " + runStatus.last_error);
      }
    }
    console.log("Run Status:", runStatus);
    // Récupérer les messages
    const messages = await client.beta.threads.messages.list(thread.id);
    console.log("Messages:", messages);
    const assistantMessage = messages.data.find(
      (message) => message.role === "assistant"
    );

    return assistantMessage;
  } catch (error) {
    console.error("Erreur lors de l'analyse de l'image:", error);
    throw error;
  }
}

async function main() {
  try {
    const response = await analyzeImageWithAssistant("./image.jpeg");
    console.log("Assistant Response:", response.content[0].text.value
    );
    const json = JSON.parse(response.content[0].text.value);
    console.log("Assistant Response:", json);
  } catch (error) {
    console.error("Erreur dans le programme principal:", error);
  }
}

main();