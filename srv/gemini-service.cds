service GeminiService @(path: '/gemini-service') {
  action prompt(prompt: String) returns { reply: String; success: Boolean; timestamp: String; };
}
