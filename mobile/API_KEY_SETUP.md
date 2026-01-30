# Environment Variables

## Gemini API Key
To use the AI-powered object detection, you need a Gemini API key from Google.

1. Get your API key from: https://makersuite.google.com/app/apikey
2. Open `app.json` and replace `YOUR_GEMINI_API_KEY_HERE` with your actual API key

Example:
```json
"extra": {
  "geminiApiKey": "AIzaSy..."
}
```

## Security Note
- Never commit your actual API key to version control
- For production, use environment variables or secure secret management
- The current setup is for development/testing purposes only
