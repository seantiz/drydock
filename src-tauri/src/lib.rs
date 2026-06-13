// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub async fn rotate(
    api_key: String,
    messages: Vec<serde_json::Value>,
    max_tokens: u32,
    lineup: Vec<&str>,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let request_body = serde_json::json!({
        "models": lineup,
        "max_tokens": max_tokens,
        "messages": messages,
    });

    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API error: {} - {}", status, error_text));
    }

    let raw_text = response.text().await.map_err(|e| format!("Read body failed: {}", e))?;

    let data: serde_json::Value = serde_json::from_str(&raw_text)
        .map_err(|e| format!("Parse failed: {}", e))?;


    // TODO: Could extract this to a utility helper
    // Strip json fences - the usual code 
    
    if let Some(content) = data["choices"][0]["message"]["content"].as_str() {
        let trimmed = content.trim();
        let cleaned = if trimmed.starts_with("```") {
            let after_fence = trimmed.lines().skip(1).collect::<Vec<_>>().join("\n");
            if let Some(end) = after_fence.rfind("```") {
                after_fence[..end].trim().to_string()
            } else {
                after_fence
            }
        } else {
            trimmed.to_string()
        };
        return Ok(cleaned);
    }

    Err(format!("Invalid response format. Full response: {}", serde_json::to_string_pretty(&data).unwrap_or_default()))
}
