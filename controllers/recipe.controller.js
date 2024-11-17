import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function deleteImageFromStrapi(imageId) {
  try {
    const response = await axios.delete(
      `${process.env.STRAPI_URL}/api/upload/files/${imageId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.STRAPI_API_TOKEN}`,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error deleting image from Strapi:", error);
    throw error;
  }
}

async function saveRecipeToStrapi(recipe, userId) {
  try {
    return await axios.post(
      `${process.env.STRAPI_URL}/api/recipes`,
      {
        data: {
          name: recipe.name,
          difficulty: recipe.stat.difficulty,
          people: parseInt(recipe.stat.people),
          time: parseInt(recipe.stat.time),
          steps: recipe.steps,
          foodrecipe: recipe.ingrediantforrecipeandsize,
          users: userId
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.STRAPI_API_TOKEN}`,
        },
      }
    );
  } catch (error) {
    console.error("Error saving recipe to Strapi:", error);
    throw error;
  }
}

async function getUserCredits(userId) {
  try {
    const userResponse = await axios.get(
      `${process.env.STRAPI_URL}/api/users/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.STRAPI_API_TOKEN}`,
        },
      }
    );
    return userResponse.data.credit || 0;
  } catch (error) {
    console.error("Error getting user credits:", error);
    throw error;
  }
}

async function updateUserCredits(userId) {
  try {
    const currentCredits = await getUserCredits(userId);
    
    if (currentCredits <= 0) {
      throw new Error("User has no credits remaining");
    }
    
    await axios.put(
      `${process.env.STRAPI_URL}/api/users/${userId}`,
      {
        credit: currentCredits - 1
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.STRAPI_API_TOKEN}`,
        },
      }
    );
  } catch (error) {
    console.error("Error updating user credits:", error);
    throw error;
  }
}

async function analyzeImageWithAssistant(imagePath, language, diet) {
  try {
    const thread = await client.beta.threads.create();
    
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: [
        { 
          type: "text", 
          text: `Analyze this image json and answer in ${language}. The recipe must follow these dietary restrictions: ${diet.join(", ")}` 
        },
        { 
          type: "image_url", 
          image_url: {
            url: imagePath,
          } 
        },
      ],
    });

    const run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.ASSISTANT_ID,
    });

    let runStatus = await client.beta.threads.runs.retrieve(thread.id, run.id);
    while (runStatus.status !== "completed") {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await client.beta.threads.runs.retrieve(thread.id, run.id);
      
      if (runStatus.status === "failed") {
        throw new Error("Run failed: " + runStatus.last_error);
      }
    }

    const messages = await client.beta.threads.messages.list(thread.id);
    const assistantMessage = messages.data.find(
      (message) => message.role === "assistant"
    );

    const tokenUsage =  runStatus.usage?.total_tokens || 0

    return {
      message: assistantMessage,
      tokenUsage
    };
  } catch (error) {
    console.error("Error during image analysis:", error);
    throw error;
  }
}

const createRecipe = async (req, res) => {
    try {
        const { imagePath, imageId, userId, language, diet } = req.body;

        // Validate required fields
        if (!imagePath || !imageId || !userId || !language || !diet) {
            return res.status(400).json({ 
                message: "Missing required fields", 
                required: ["imagePath", "imageId", "userId", "language", "diet"],
                received: req.body 
            });
        }

        // Validate diet is an array
        if (!Array.isArray(diet)) {
            return res.status(400).json({ 
                message: "Diet must be an array",
                received: diet 
            });
        }


        const currentCredits = await getUserCredits(userId);
        if (currentCredits <= 0) {
            await deleteImageFromStrapi(imageId);
            return res.status(403).json({
                message: "Insufficient credits",
                credits: currentCredits
            });
        }

        const { message: analysisResponse, tokenUsage } = await analyzeImageWithAssistant(imagePath, language, diet);
        const analysisData = JSON.parse(analysisResponse.content[0].text.value);

        const savedRecipes = [];
        for (const recipe of analysisData.recipes) {
            const savedRecipe = await saveRecipeToStrapi(recipe, userId);
            savedRecipes.push(savedRecipe.data);
        }
        await updateUserCredits(userId);

        await deleteImageFromStrapi(imageId);

        res.status(201).json({
            message: "Recipes created successfully, user credits updated, and temporary image deleted",
            savedRecipes,
            userId,
            remainingCredits: currentCredits - 1,
            tokenUsage,
            foods: analysisData.foods
        });
    } catch (error) {
        // Clean up the uploaded image in case of error
        if (req.body.imageId) {
            try {
                await deleteImageFromStrapi(req.body.imageId);
            } catch (deleteError) {
                console.error("Error deleting image after failure:", deleteError);
            }
        }

        console.error("Error creating recipe:", error);
        res.status(error.message === "Insufficient credits" ? 403 : 500).json({ 
            message: error.message || "Internal server error",
            error: error.message 
        });
    }
};

export { createRecipe };