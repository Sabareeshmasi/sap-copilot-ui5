const cds = require("@sap/cds");
const axios = require("axios");

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";
const GEMINI_KEY = process.env.GEMINI_API_KEY;

module.exports = cds.service.impl(async function () {
  this.on("prompt", async (req) => {
    const prompt = req.data.prompt;

    try {
      const response = await axios.post(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      });

      const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No reply from Gemini.";
      return { reply };
    } catch (err) {
      console.error("Gemini Error:", err.message);
      return { reply: "Error: Could not reach Gemini." };
    }
  });
});
