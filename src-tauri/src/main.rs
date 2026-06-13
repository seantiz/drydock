#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use ::drydock_lib::rotate;
use ndarray::{Array1, Axis, aview1, stack};
use rand::rngs::SmallRng;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool, query, query_as};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;
use rand::{RngExt, SeedableRng};

type EvidenceTable = Vec<(String, String, String, String, String, Option<String>, i32, i32)>;

#[derive(Debug, Serialize)]
struct HnSignal {
    uri: String,
    author: String,
    text: String,
    created_at: String,
    keyword_matches: usize,
    post_url: String,
}

#[derive(Debug, Serialize)]
struct BlueskySignal {
    uri: String,
    author: String,
    author_avatar: String,
    text: String,
    created_at: String,
    keyword_matches: usize,
    post_url: String,
}

#[derive(Debug, Deserialize)]
struct SessionResponse {
    #[serde(rename = "accessJwt")]
    access_jwt: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct TopicNature {
    frequency: String,
    confidence: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct EvidenceItem {
    id: String,
    source: String,
    title: String,
    snippet: String,
    captured_at: String,
    sentiment: Option<String>,
    weight: i32,
    times_used: u32,
    effective_weight: f64,
}

#[derive(Debug, Serialize)]
struct TopicBuckets {
    label: String,
    issue_ids: Vec<String>,
}

#[derive(Debug)]
struct Issue {
    external_github_id: String,
    title: String,
    vector: Array1<f32>,
}

#[derive(Debug, Serialize)]
pub struct UrlEvidence {
    pub title: String,
    pub author: String,
    pub snippet: String,
    pub source: String,
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct NetworkPost {
    pub source: String,
    pub uri: String,
    pub author_handle: String,
    pub author_avatar: String,
    pub text: String,
    pub created_at: String,
    // Bluesky / Twitter engagement
    pub replies: u32,
    pub reposts: u32,
    pub likes: u32,
    pub quoted: u32,
    // HN engagement
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub descendants: Option<u32>,
    pub post_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum OutputFormat {
    Blog,
    BlueskyPost,
    BlueskyThread,
    Instagram,
}

#[derive(Debug, Serialize)]
struct RankedEvidence {
    id: String,
    source: String,
    title: String,
    snippet: String,
    captured_at: String,
    sentiment: Option<String>,
    weight: i32,
    times_used: i32,
    effective_weight: f64,
}

// Like previously_on_drydock but without the voice meta
async fn evidence_ranker(
    pool: &SqlitePool,
    bet_id: &str,
) -> Result<Vec<RankedEvidence>, String> {
    let rows: EvidenceTable = query_as(
    "SELECT id, source, title, snippet, captured_at, sentiment, weight, times_used FROM evidence WHERE prediction_id = ?"
)
.bind(bet_id)
.fetch_all(pool)
.await
.map_err(|e| e.to_string())?;

    let mut ranked: Vec<RankedEvidence> = rows
        .into_iter()
        .map(
            |(id, source, title, snippet, captured_at, sentiment, weight, times_used)| {
                let decay_rate = match sentiment.as_deref() {
                    Some("supports") | Some("refutes") => 0.4_f64,
                    _ => 0.8_f64,
                };
                let effective_weight = (weight as f64) * decay_rate.powi(times_used);
                RankedEvidence {
                    id,
                    source,
                    title,
                    snippet,
                    captured_at,
                    sentiment,
                    weight,
                    times_used,
                    effective_weight,
                }
            },
        )
        .collect();

    ranked.sort_by(|a, b| {
        b.effective_weight
            .partial_cmp(&a.effective_weight)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(ranked)
}

async fn previously_on_drydock(
    pool: &SqlitePool,
    bet_id: &str,
    narrative_voice: &str,
) -> Result<Vec<RankedEvidence>, String> {
    let rows: EvidenceTable = query_as(
    "SELECT id, source, title, snippet, captured_at, sentiment, weight, times_used FROM evidence WHERE prediction_id = ?"
)
.bind(bet_id)
.fetch_all(pool)
.await
.map_err(|e| e.to_string())?;

    let mut ranked: Vec<RankedEvidence> = rows
        .into_iter()
        .map(
            |(id, source, title, snippet, captured_at, sentiment, weight, times_used)| {
                let effective_weight = match narrative_voice {
                    "witness" => {
                        let age_secs = captured_at.parse::<i64>().unwrap_or(0);
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs() as i64;
                        let age_days = ((now - age_secs) / 86400).max(0) as f64;
                        let recency = (1.0 - (age_days / 90.0).min(1.0)).max(0.0);
                        (weight as f64) * recency
                    }
                    "reckoning" => {
                        let decay_rate = 0.3_f64;
                        (weight as f64) * decay_rate.powi(times_used)
                    }
                    _ => {
                        let decay_rate = match sentiment.as_deref() {
                            Some("supports") | Some("refutes") => 0.4_f64,
                            _ => 0.5_f64,
                        };
                        (weight as f64) * decay_rate.powi(times_used)
                    }
                };
                RankedEvidence {
                    id,
                    source,
                    title,
                    snippet,
                    captured_at,
                    sentiment,
                    weight,
                    times_used,
                    effective_weight,
                }
            },
        )
        .collect();

    ranked.sort_by(|a, b| {
        b.effective_weight
            .partial_cmp(&a.effective_weight)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(ranked)
}

#[tauri::command]
async fn trawl_bsky(handle: String, app_password: String) -> Result<String, String> {
    let client = reqwest::Client::new();

    let session_resp = client
        .post("https://bsky.social/xrpc/com.atproto.server.createSession")
        .json(&serde_json::json!({
            "identifier": handle,
            "password": app_password
        }))
        .send()
        .await
        .map_err(|e| format!("Session request failed: {}", e))?;

    if !session_resp.status().is_success() {
        return Err(format!(
            "Auth failed: {}",
            session_resp.text().await.unwrap_or_default()
        ));
    }

    let session: SessionResponse = session_resp
        .json()
        .await
        .map_err(|e| format!("Session parse failed: {}", e))?;

    Ok(session.access_jwt)
}

#[tauri::command]
async fn fetch_bluesky_posts(
    access_token: String,
    keywords: String,
    limit: u32,
) -> Result<Vec<BlueskySignal>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Client build failed: {}", e))?;

    let encoded_query = urlencoding::encode(&keywords);
    let url = format!(
        "https://bsky.social/xrpc/app.bsky.feed.searchPosts?q={}&limit={}",
        encoded_query, limit
    );

    let search_resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    if !search_resp.status().is_success() {
        return Err(format!(
            "Search failed: {}",
            search_resp.text().await.unwrap_or_default()
        ));
    }

    let json: serde_json::Value = search_resp
        .json()
        .await
        .map_err(|e| format!("Search parse failed: {}", e))?;

    let posts = json["posts"].as_array().ok_or("No posts field")?;

    // IMPORTANT: Hit only on comma-separate strings not individual words
    let keywords_vec: Vec<String> = keywords
        .split(',')
        .map(|k| k.trim().to_lowercase())
        .collect();

    let mut signals: Vec<BlueskySignal> = Vec::new();

    for post in posts.iter() {
        let text = post["record"]["text"].as_str().unwrap_or("");
        let uri = post["uri"].as_str().unwrap_or("");
        let author_handle = post["author"]["handle"].as_str().unwrap_or("");
        let author_avatar = post["author"]["avatar"].as_str().unwrap_or("");
        let created_at = post["record"]["createdAt"].as_str().unwrap_or("");

        let keyword_matches = keywords_vec
            .iter()
            .filter(|k| text.to_lowercase().contains(k.as_str()))
            .count();

        let post_id = uri.split('/').next_back().unwrap_or("");
        let post_url = format!(
            "https://bsky.app/profile/{}/post/{}",
            author_handle, post_id
        );

        signals.push(BlueskySignal {
            uri: uri.to_string(),
            author: author_handle.to_string(),
            author_avatar: author_avatar.to_string(),
            text: text.to_string(),
            created_at: created_at.to_string(),
            keyword_matches,
            post_url,
        });
    }

    Ok(signals)
}

#[tauri::command]
async fn fetch_hn_posts(keywords: Vec<String>) -> Result<Vec<HnSignal>, String> {
    let client = reqwest::Client::new();
    let mut signals: Vec<HnSignal> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .saturating_sub(30 * 86400);

    for keyword_string in &keywords {
        let encoded = urlencoding::encode(keyword_string);
        let url = format!(
            "https://hn.algolia.com/api/v1/search?query={}&tags=story&hitsPerPage=25&numericFilters=created_at_i>{}",
            encoded, cutoff
        );

        let resp = match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };

        let json: serde_json::Value = match resp.json().await {
            Ok(j) => j,
            Err(_) => continue,
        };

        let hits = match json["hits"].as_array() {
            Some(h) => h,
            None => continue,
        };

        // Count matches the same way Bluesky does: how many comma-separated terms appear in the title
        let terms: Vec<String> = keyword_string
            .split(',')
            .map(|k| k.trim().to_lowercase())
            .collect();

        for hit in hits {
            let object_id = match hit["objectID"].as_str() {
                Some(id) if !id.is_empty() => id.to_string(),
                _ => continue,
            };

            if seen_ids.contains(&object_id) {
                continue;
            }

            let title = hit["title"].as_str().unwrap_or("").to_string();
            let author = hit["author"].as_str().unwrap_or("").to_string();
            let created_at = hit["created_at"].as_str().unwrap_or("").to_string();
            let post_url = format!("https://news.ycombinator.com/item?id={}", object_id);

            let keyword_matches = terms
                .iter()
                .filter(|k| title.to_lowercase().contains(k.as_str()))
                .count();

            seen_ids.insert(object_id);
            signals.push(HnSignal {
                uri: post_url.clone(),
                author,
                text: title,
                created_at,
                keyword_matches,
                post_url,
            });
        }
    }

    Ok(signals)
}

// Drydock navbar user settings
#[tauri::command]
async fn get_settings(app: AppHandle, key: String) -> Result<String, String> {
    let store = app.store("credentials.json").map_err(|e| e.to_string())?;

    let value = store.get(&key).ok_or("Credential not found".to_string())?;
    Ok(value
        .as_str()
        .ok_or("Couldn't read credential info. Please report this if it continues to happen.")?
        .to_string())
}

#[tauri::command]
async fn push_settings(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let store = app.store("credentials.json").map_err(|e| e.to_string())?;
    store.set(key, serde_json::json!(value));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_settings(app: AppHandle, key: String) -> Result<(), String> {
    let store = app.store("credentials.json").map_err(|e| e.to_string())?;
    store.delete(key);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn save_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let store = app.store("themes.json").map_err(|e| e.to_string())?;
    store.set("theme", serde_json::json!(theme));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn load_theme(app: AppHandle) -> Result<String, String> {
    let store = app.store("themes.json").map_err(|e| e.to_string())?;

    match store.get("theme") {
        Some(value) => {
            let ridiculous_serde_container = value.as_str().unwrap_or("");
            Ok(ridiculous_serde_container.to_string())
        }
        None => Ok("".to_string()),
    }
}

#[tauri::command]
async fn batter_up(
    pool: State<'_, SqlitePool>,
    evidence_ids: Vec<String>,
) -> Result<(), String> {
    if evidence_ids.is_empty() {
        return Ok(());
    }

    for id in &evidence_ids {
        query("UPDATE evidence SET times_used = times_used + 1 WHERE id = ?")
            .bind(id)
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}


// Used by Outbox.loadOcean()




fn find_priority_evidence(narrative_voice: &str) -> &'static str {
    match narrative_voice {
        "chronicle" => {
            r#"EVIDENCE CHIP ASSIGNMENT:
Assign 1-3 evidenceChips per block. Pull from the KEY EVIDENCE list above.

Role → sentiment affinity:
- unexpected_connection: neutral (setup) + any polarity for the reveal
- pattern_hunters: neutral primarily
- underground_current: neutral + supports
- assumptions_collide: supports AND refutes both welcome
- unraveling: refutes primarily
- new_map: heaviest polarity — use your strongest evidence here

Rules:
- PREFER evidence with times_used=0 (fresh, unspent)
- Match sentiment to the role affinity above
- Copy evidenceId EXACTLY as it appears in the evidence list
- Copy title and snippet verbatim from the evidence entry
- Only reuse spent evidence (times_used > 0) if no better option exists
- Set confidence 0.0-1.0 based on how well the evidence fits the block"#
        }
        "reckoning" => {
            r#"EVIDENCE CHIP ASSIGNMENT:
Assign 1-3 evidenceChips per block. Pull from the KEY EVIDENCE list above.

Role → sentiment affinity:
- the_consensus: neutral primarily — establish the settled view without editorialising
- the_case_for: supports strongly preferred
- the_crack: refutes or contradictory neutral — this is where consensus breaks
- the_case_against: refutes strongly preferred
- outcome: balanced mix — the synthesis earns its weight from both sides

Rules:
- PREFER evidence with times_used=0 (fresh, unspent)
- Spent evidence decays heavily — avoid reuse unless no alternatives exist
- Copy evidenceId EXACTLY as it appears in the evidence list
- Copy title and snippet verbatim from the evidence entry
- Set confidence 0.0-1.0 based on how well the evidence fits the block"#
        }
        "witness" => {
            r#"EVIDENCE CHIP ASSIGNMENT:
Assign 1-3 evidenceChips per block. Pull from the KEY EVIDENCE list above.

Role → sentiment affinity:
- proposition: neutral — state what is being investigated without prejudging
- observation: any sentiment — direct field evidence, prefer freshest by captured_at date
- conclusion: any sentiment — what the observations actually say

Rules:
- Recency is the primary sort key — prefer evidence with the most recent captured_at
- No use-count decay applies here; a fresh neutral observation beats a stale strong signal
- Copy evidenceId EXACTLY as it appears in the evidence list
- Copy title and snippet verbatim from the evidence entry
- Set confidence 0.0-1.0 based on how well the evidence fits the block"#
        }
        _ => {
            r#"EVIDENCE CHIP ASSIGNMENT:
Assign 1-3 evidenceChips per block where relevant. Pull from the KEY EVIDENCE list above.
- Copy evidenceId EXACTLY as it appears in the evidence list
- Prefer evidence with times_used=0
- Set confidence 0.0-1.0"#
        }
    }
}

#[tauri::command]
async fn starter_draft(
    pool: State<'_, SqlitePool>,
    api_key: String,
    bet_id: String,
    narrative_voice: String,
    output_format: OutputFormat,
    selected_role: Option<String>,
) -> Result<String, String> {
    use chrono::DateTime;

    let (claim, description, initial_confidence, current_confidence): (String, String, i32, i32) =
        query_as("SELECT claim, description, initial_confidence, current_confidence FROM predictions WHERE id = ?")
            .bind(&bet_id)
            .fetch_one(&*pool)
            .await
            .map_err(|e| format!("Bet not found: {}", e))?;

    let ranked = previously_on_drydock(&pool, &bet_id, &narrative_voice).await?;

    let confidence_delta = current_confidence - initial_confidence;
    let evidence_count = ranked.len();

    let mut supports = 0usize;
    let mut refutes = 0usize;
    let mut neutral = 0usize;
    for e in &ranked {
        match e.sentiment.as_deref() {
            Some("supports") => supports += 1,
            Some("refutes") => refutes += 1,
            _ => neutral += 1,
        }
    }

    let timestamps: Vec<chrono::DateTime<chrono::Local>> = ranked
        .iter()
        .filter_map(|e| {
            DateTime::parse_from_rfc3339(&e.captured_at)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Local))
        })
        .collect();
    let months = if timestamps.len() >= 2 {
        let earliest = timestamps.iter().min().unwrap();
        let latest = timestamps.iter().max().unwrap();
        (*latest - *earliest).num_days() as f64 / 30.0
    } else {
        0.0
    };

    let evidence_rules = find_priority_evidence(&narrative_voice);

    let (system_prompt, output_instructions) = match output_format {
        OutputFormat::Blog => (
            format!(
                r#"You are a narrative architect generating a blog post scaffold in the "{}" style.

You must return a JSON array of exactly 6 blocks, one per role, in this order:
1. unexpected_connection
2. pattern_hunters
3. underground_current
4. assumptions_collide
5. unraveling
6. new_map

Each block must follow this shape:
{{
  "id": "<unique short id>",
  "role": "<role from the list above>",
  "heading": "<a compelling section title you write>",
  "content": "<2-3 sentences of kickstart prose for the user to expand>",
  "evidenceChips": [
    {{
      "evidenceId": "<id from evidence list>",
      "title": "<copy from evidence>",
      "snippet": "<copy from evidence>",
      "sentiment": "<copy from evidence>",
      "confidence": 0.0
    }}
  ],
  "position": <0-based index>
}}

{}

Return only the JSON array. No markdown, no explanation."#,
                narrative_voice, evidence_rules
            ),
            "Return a JSON array of 6 scaffold blocks as specified.",
        ),
        OutputFormat::BlueskyPost => (
            format!(
                r#"You are a narrative architect generating a single Bluesky post scaffold in the "{}" style.

Generate a JSON array containing exactly one block for the role "{}":
{{
  "id": "<unique short id>",
  "role": "{}",
  "heading": "<a compelling post hook>",
  "content": "<a single punchy post, 280 chars max>",
  "evidenceChips": [
    {{
      "evidenceId": "<id from evidence list>",
      "title": "<copy from evidence>",
      "snippet": "<copy from evidence>",
      "sentiment": "<copy from evidence>",
      "confidence": 0.0
    }}
  ],
  "position": 0
}}

{}

Return only the JSON array. No markdown, no explanation."#,
                narrative_voice,
                selected_role.as_deref().unwrap_or("unexpected_connection"),
                selected_role.as_deref().unwrap_or("unexpected_connection"),
                evidence_rules,
            ),
            "Return a JSON array with one scaffold block as specified.",
        ),
        OutputFormat::BlueskyThread => (
            format!(
                r#"You are a narrative architect generating a Bluesky thread scaffold in the "{}" style.

You must return a JSON array of exactly 6 blocks, one per role, in this order:
1. unexpected_connection
2. pattern_hunters
3. underground_current
4. assumptions_collide
5. unraveling
6. new_map

Each block must follow this shape:
{{
  "id": "<unique short id>",
  "role": "<role from the list above>",
  "heading": "<a compelling section hook>",
  "content": "<2-3 tweet-sized chunks (280 chars each), separated by newlines>",
  "evidenceChips": [
    {{
      "evidenceId": "<id from evidence list>",
      "title": "<copy from evidence>",
      "snippet": "<copy from evidence>",
      "sentiment": "<copy from evidence>",
      "confidence": 0.0
    }}
  ],
  "position": <0-based index>
}}

{}

Return only the JSON array. No markdown, no explanation."#,
                narrative_voice, evidence_rules
            ),
            "Return a JSON array of 6 scaffold blocks as specified.",
        ),
        OutputFormat::Instagram => (
            format!(
                r#"You are a narrative architect generating a single Instagram caption scaffold in the "{}" style.

Generate a JSON array containing exactly one block for the role "{}":
{{
  "id": "<unique short id>",
  "role": "{}",
  "heading": "<a compelling caption hook>",
  "content": "<a punchy caption, max 500 chars, ending with 5-7 relevant hashtags>",
  "evidenceChips": [
    {{
      "evidenceId": "<id from evidence list>",
      "title": "<copy from evidence>",
      "snippet": "<copy from evidence>",
      "sentiment": "<copy from evidence>",
      "confidence": 0.0
    }}
  ],
  "position": 0
}}

{}

Return only the JSON array. No markdown, no explanation."#,
                narrative_voice,
                selected_role.as_deref().unwrap_or("unexpected_connection"),
                selected_role.as_deref().unwrap_or("unexpected_connection"),
                evidence_rules,
            ),
            "Return a JSON array with one scaffold block as specified.",
        ),
    };

    let user_message = format!(
        r#"Create a content scaffold for this prediction:

CLAIM: {}
DESCRIPTION: {}

CONFIDENCE: Started at {}%, now at {}% (delta: {:+}%)
EVIDENCE: {} pieces spanning {:.1} months

SENTIMENT DISTRIBUTION:
- Supports: {}
- Refutes: {}
- Neutral: {}

KEY EVIDENCE:
{}

{}"#,
        claim,
        description,
        initial_confidence,
        current_confidence,
        confidence_delta,
        evidence_count,
        months,
        supports,
        refutes,
        neutral,
        ranked
            .iter()
            .map(|e| format!(
                "- [id={}] [sentiment={}] [times_used={}] [eff_weight={:.1}] {} | {}: {}",
                e.id,
                e.sentiment.as_deref().unwrap_or("neutral"),
                e.times_used,
                e.effective_weight,
                e.source,
                e.title,
                e.snippet
            ))
            .collect::<Vec<_>>()
            .join("\n"),
        output_instructions
    );

    let messages = vec![
        serde_json::json!({ "role": "system", "content": system_prompt }),
        serde_json::json!({ "role": "user", "content": user_message }),
    ];
    let lineup = vec!["google/gemini-2.5-flash-lite", "deepseek/deepseek-v3.2"];

    rotate(api_key, messages, 4000, lineup).await
    

    // --- Local (Ollama) version — kept for easy re-wiring ---
    // let prompt = format!("{}\n\n{}", system_prompt, user_message);
    // let client = reqwest::Client::new();
    // let resp = client
    //     .post("http://localhost:11434/api/generate")
    //     .json(&serde_json::json!({
    //         "model": "qwen2.5:7b",
    //         "prompt": prompt,
    //         "stream": false,
    //         "options": { "num_ctx": 8192 }
    //     }))
    //     .send()
    //     .await
    //     .map_err(|e| format!("Ollama request failed: {}", e))?;
    // let json: serde_json::Value = resp
    //     .json()
    //     .await
    //     .map_err(|e| format!("Ollama parse failed: {}", e))?;
    // let raw = json["response"]
    //     .as_str()
    //     .ok_or_else(|| "No response field in Ollama output".to_string())?;
    // let trimmed = raw.trim();
    // if trimmed.starts_with("```") {
    //     let after_fence = trimmed.lines().skip(1).collect::<Vec<_>>().join("\n");
    //     if let Some(end) = after_fence.rfind("```") {
    //         Ok(after_fence[..end].trim().to_string())
    //     } else {
    //         Ok(after_fence)
    //     }
    // } else {
    //     Ok(trimmed.to_string())
    // }
}


// Static ui that describe each article block's role in the user's chosen narrative.
const CHRONICLE_ANCHORS: &[(&str, &str)] = &[
    (
        "unexpected_connection",
        "Evidence that reveals a surprising or counterintuitive link between two seemingly \
         unrelated ideas, fields, or trends — something the audience would not expect.",
    ),
    (
        "pattern_hunters",
        "Evidence that demonstrates a recurring pattern, trend, or consistent behaviour \
         observed across multiple data points, time periods, or independent sources.",
    ),
    (
        "underground_current",
        "Evidence that hints at a hidden force, subtle shift, or underlying dynamic \
         that is not yet widely recognised or discussed in mainstream conversation.",
    ),
    (
        "assumptions_collide",
        "Evidence that creates productive tension by simultaneously supporting one \
         interpretation and challenging another — where reasonable people would disagree.",
    ),
    (
        "unraveling",
        "Evidence that directly contradicts, undermines, or complicates a previously \
         held assumption, popular belief, or the author's own earlier position.",
    ),
    (
        "new_map",
        "Evidence that points toward a synthesis, actionable conclusion, or new mental \
         model — something that reframes how the reader should think about the topic going forward.",
    ),
];

const RECKONING_ANCHORS: &[(&str, &str)] = &[
    (
        "the_consensus",
        "Evidence that establishes the settled, widely-accepted view on a topic — \
         the position most people hold before the argument begins.",
    ),
    (
        "the_case_for",
        "Evidence that supports and strengthens the consensus view — \
         the strongest arguments in favour of the established position.",
    ),
    (
        "the_crack",
        "Evidence that reveals a flaw, contradiction, or tension in the consensus — \
         the moment where the settled view begins to break down.",
    ),
    (
        "the_case_against",
        "Evidence that directly refutes or undermines the consensus — \
         the strongest counter-arguments and contradicting data.",
    ),
    (
        "outcome",
        "Evidence that points toward a resolution, synthesis, or new position — \
         what we should believe after weighing both sides.",
    ),
];

const WITNESS_ANCHORS: &[(&str, &str)] = &[
    (
        "proposition",
        "Evidence that frames what is being investigated — \
         the hypothesis, question, or phenomenon under observation.",
    ),
    (
        "observation",
        "Direct field evidence — specific, concrete things witnessed, measured, or documented \
         from the real world.",
    ),
    (
        "conclusion",
        "Evidence that interprets the observations and states what they mean — \
         the pattern or finding that emerges from the data.",
    ),
];

// Tokenise the article block roles as anchors
// Then find an article block where evidence belongs
#[tauri::command]
async fn match_evidence_to_blocks(
    evidence: Vec<EvidenceItem>,
    narrative_voice: String,
) -> Result<HashMap<String, String>, String> {
    if evidence.is_empty() {
        return Ok(HashMap::new());
    }

    let anchors = match narrative_voice.as_str() {
        "reckoning" => RECKONING_ANCHORS,
        "witness" => WITNESS_ANCHORS,
        _ => CHRONICLE_ANCHORS,
    };

    let fallback = anchors[0].0;

    let mut roles: Vec<(&str, Array1<f32>)> = Vec::new();
    for (role, text) in anchors.iter() {
        let vec = embed_text(text.to_string()).await?;
        roles.push((*role, Array1::from(vec)));
    }

    let mut snippets: Vec<(&str, Array1<f32>)> = Vec::new();
    for item in evidence.iter() {
        let vec = embed_text(item.snippet.clone()).await?;
        snippets.push((item.id.as_str(), Array1::from(vec)));
    }

    // WARN: Should we really be eagerly falling back here?
    let mut matches = HashMap::new();
    for (id, vector) in snippets {
        let closest = roles
            .iter()
            .map(|(role, anchor)| (*role, vector.dot(anchor)))
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(role, _)| role)
            .unwrap_or(fallback);
        matches.insert(id.to_string(), closest.to_string());
    }

    Ok(matches)
}




#[tauri::command]
async fn match_orphan_to_issue(
    pool: State<'_, SqlitePool>,
    orphan_id: String,
    coastline_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let orphan = query("SELECT title, body FROM coastline_concern_sources WHERE id = ?")
        .bind(&orphan_id)
        .fetch_one(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    let orphan_title: String = orphan.try_get("title").unwrap_or_default();
    let orphan_body: String = orphan.try_get("body").unwrap_or_default();
    let orphan_text = format!("{} {}", orphan_title, orphan_body);
    let orphan_text = orphan_text.trim();
    if orphan_text.is_empty() {
        return Ok(None);
    }

    // send to nomic
    let client = reqwest::Client::new();
    let embed_resp = client
        .post("http://localhost:11434/api/embeddings")
        .json(&serde_json::json!({
            "model": "nomic-embed-text",
            "prompt": &orphan_text[..orphan_text.len().min(20000)],
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let embed_json: serde_json::Value = embed_resp.json().await.map_err(|e| e.to_string())?;
    let orphan_vec: Array1<f32> = {
        let floats: Vec<f32> = embed_json["embedding"]
            .as_array()
            .ok_or("No embedding returned")?
            .iter()
            .filter_map(|val| val.as_f64().map(|n| n as f32))
            .collect();
        let a = Array1::from(floats);
        let boundary = a.dot(&a).sqrt();
        a / boundary
    };

    // Load all issue vectors for repo
    let rows = query(
        r#"
        SELECT ccs.id, ccs.external_id, ccs.title, ce.vector
        FROM coastline_concern_sources ccs
        JOIN coastline_embeddings ce ON ce.source_id = ccs.id
        WHERE ccs.coastline_id = ? AND ccs.signal_type = 'issue'
        "#,
    )
    .bind(&coastline_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    // Score all issues
    let mut scored: Vec<(String, String, f32)> = rows
        .into_iter()
        .filter_map(|row| {
            let external_id: String = row.try_get("external_id").ok()?;
            let title: String = row.try_get("title").ok()?;
            let bytes: Vec<u8> = row.try_get("vector").ok()?;
            let vec = load_tokens(&bytes);
            let score = orphan_vec.dot(&vec);
            Some((external_id, title, score))
        })
        .collect();

    scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(20);

    if scored.is_empty() {
        return Ok(None);
    }

    let top5: Vec<serde_json::Value> = scored
        .iter()
        .take(5)
        .map(|(num, title, _)| serde_json::json!({ "issueNumber": num, "issueTitle": title }))
        .collect();

    let candidates: Vec<(String, String)> = scored
        .iter()
        .map(|(num, title, _)| (num.clone(), title.clone()))
        .collect();
    let best = pick_best_match(&scored, &top5);

    Ok(Some(serde_json::json!({
        "match": best,
        "candidates": top5,
    })))
}

#[tauri::command]
async fn scout_network(app: AppHandle, terms: Vec<String>) -> Result<Vec<NetworkPost>, String> {
    let store = app.store("credentials.json").map_err(|e| e.to_string())?;
    let handle = store
        .get("bluesky_handle")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or("Bluesky handle not configured")?;
    let app_password = store
        .get("bluesky_app_password")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or("Bluesky app password not configured")?;

    let auth_client = reqwest::Client::new();
    let session_resp = auth_client
        .post("https://bsky.social/xrpc/com.atproto.server.createSession")
        .json(&serde_json::json!({ "identifier": handle, "password": app_password }))
        .send()
        .await
        .map_err(|e| format!("Session request failed: {}", e))?;

    if !session_resp.status().is_success() {
        return Err(format!(
            "Bluesky auth failed: {}",
            session_resp.text().await.unwrap_or_default()
        ));
    }

    let session: SessionResponse = session_resp
        .json()
        .await
        .map_err(|e| format!("Session parse failed: {}", e))?;
    let access_token = session.access_jwt;

    let client = reqwest::Client::new();
    let mut all_posts: Vec<NetworkPost> = Vec::new();
    let mut seen_uris: HashSet<String> = HashSet::new();

    for term in &terms {
        let encoded_query = urlencoding::encode(term);
        let url = format!(
            "https://bsky.social/xrpc/app.bsky.feed.searchPosts?q={}&limit=100",
            encoded_query
        );

        let search_resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await
            .map_err(|e| format!("Search request failed: {}", e))?;

        if !search_resp.status().is_success() {
            continue;
        }

        let json: serde_json::Value = search_resp
            .json()
            .await
            .map_err(|e| format!("Search parse failed: {}", e))?;

        let posts = match json["posts"].as_array() {
            Some(p) => p,
            None => continue,
        };

        for post in posts.iter() {
            let uri = post["uri"].as_str().unwrap_or("").to_string();
            if uri.is_empty() || seen_uris.contains(&uri) {
                continue;
            }

            let created_at = post["record"]["createdAt"]
                .as_str()
                .unwrap_or("")
                .to_string();

            let author_handle = post["author"]["handle"].as_str().unwrap_or("").to_string();
            let author_avatar = post["author"]["avatar"].as_str().unwrap_or("").to_string();
            let text = post["record"]["text"].as_str().unwrap_or("").to_string();
            let replies = post["replyCount"].as_u64().unwrap_or(0) as u32;
            let reposts = post["repostCount"].as_u64().unwrap_or(0) as u32;
            let likes = post["likeCount"].as_u64().unwrap_or(0) as u32;
            let quoted = post["quoteCount"].as_u64().unwrap_or(0) as u32;

            let post_id = uri.split('/').next_back().unwrap_or("");
            let post_url = format!(
                "https://bsky.app/profile/{}/post/{}",
                author_handle, post_id
            );

            seen_uris.insert(uri.clone());
            all_posts.push(NetworkPost {
                source: "bluesky".to_string(),
                uri,
                author_handle,
                author_avatar,
                text,
                created_at,
                replies,
                reposts,
                likes,
                quoted,
                score: None,
                descendants: None,
                post_url,
            });
        }
    }

    // HN via Algolia public api — constrain to 30 days so results land inside the 14-day viewport
    let hn_cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .saturating_sub(30 * 86400);

    for term in &terms {
        let encoded_query = urlencoding::encode(term);
        let url = format!(
            "https://hn.algolia.com/api/v1/search?query={}&tags=story&hitsPerPage=25&numericFilters=created_at_i>{}",
            encoded_query, hn_cutoff
        );

        let hn_resp = match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };

        let json: serde_json::Value = match hn_resp.json().await {
            Ok(j) => j,
            Err(_) => continue,
        };

        let hits = match json["hits"].as_array() {
            Some(h) => h,
            None => continue,
        };

        for hit in hits.iter() {
            let object_id = match hit["objectID"].as_str() {
                Some(id) if !id.is_empty() => id,
                _ => continue,
            };

            let uri = format!("https://news.ycombinator.com/item?id={}", object_id);
            if seen_uris.contains(&uri) {
                continue;
            }

            let title = hit["title"].as_str().unwrap_or("").to_string();
            let author_handle = hit["author"].as_str().unwrap_or("").to_string();
            let created_at = hit["created_at"].as_str().unwrap_or("").to_string();
            let score = hit["points"].as_u64().map(|v| v as u32);
            let descendants = hit["num_comments"].as_u64().map(|v| v as u32);

            seen_uris.insert(uri.clone());
            all_posts.push(NetworkPost {
                source: "hackernews".to_string(),
                uri: uri.clone(),
                author_handle,
                author_avatar: "".to_string(),
                text: title,
                created_at,
                replies: 0,
                reposts: 0,
                likes: 0,
                quoted: 0,
                score,
                descendants,
                post_url: uri,
            });
        }
    }

    all_posts.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(all_posts)
}

// NOTE: Only used by Coastline service
// When the float records and pulled downstream, load_tokens() handles pushing it to an 2D array
#[tauri::command]
async fn send_to_nomic(
    pool: State<'_, SqlitePool>,
    source_id: String,
    text: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("http://localhost:11434/api/embeddings")
        .json(&serde_json::json!({
            "model": "nomic-embed-text",
            "prompt": &text[..text.len().min(20000)],
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let arr = match json["embedding"].as_array() {
        Some(a) => a,
        None => return Ok(()),
    };
    let vectors: Vec<f32> = arr
        .iter()
        .filter_map(|json_value| json_value.as_f64().map(|float_number| float_number as f32))
        .collect();

    let bytes: Vec<u8> = vectors.iter().flat_map(|f| f.to_le_bytes()).collect();

    query("INSERT OR REPLACE INTO coastline_embeddings (source_id, vector) VALUES (?, ?)")
        .bind(&source_id)
        .bind(&bytes)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn find_coastline_topics(
    pool: State<'_, SqlitePool>,
    coastline_id: String,
) -> Result<Vec<TopicBuckets>, String> {
    let rows = query(
        r#"
    SELECT ccs.external_id, ccs.title, ce.vector
    FROM coastline_concern_sources ccs
    JOIN coastline_embeddings ce ON ce.source_id = ccs.id
    WHERE ccs.coastline_id = ? AND ccs.signal_type = 'issue'
    "#,
    )
    .bind(&coastline_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let issues: Vec<Issue> = rows
        .into_iter()
        .filter_map(|row| {
            let bytes: Vec<u8> = row.try_get("vector").ok()?;
            let vec = load_tokens(&bytes);
            Some(Issue {
                external_github_id: row.try_get("external_id").unwrap_or_default(),
                title: row.try_get("title").unwrap_or_default(),
                vector: vec,
            })
        })
        .collect();
    if issues.is_empty() {
        return Ok(vec![]);
    }

    // Build a tf-idf table first
    let mut ratiod: HashMap<String, usize> = HashMap::new();
    for issue in &issues {
        let words: std::collections::HashSet<String> = issue
            .title
            .split_whitespace()
            .map(|w| w.to_lowercase())
            .collect();
        for w in words {
            *ratiod.entry(w).or_insert(0) += 1;
        }
    }

    let total_i = issues.len();

    // K-means directly on raw nomic vectors — no PCA
    let total_b = ((total_i as f64).ln().round() as usize + 2).clamp(2, 9);
    let raw_vecs: Vec<Array1<f32>> = issues.iter().map(|iss| iss.vector.clone()).collect();
    let matches = run_kmeans(&raw_vecs, total_b);

    let mut bucket_map: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, &c) in matches.iter().enumerate() {
        bucket_map.entry(c).or_default().push(i);
    }
    let buckets: Vec<Vec<usize>> = bucket_map.into_values().collect();

    let client = reqwest::Client::new();

    let mut result: Vec<TopicBuckets> = Vec::new();

    for issue_ids in buckets.into_iter().filter(|i| !i.is_empty()) {
        let mut issue_headers = String::new();
        let mut github_ids: Vec<String> = Vec::new();

        for &by_index in &issue_ids {
            let ratiod_title: String = issues[by_index]
                .title
                .split_whitespace()
                .filter(|w| {
                    let count = ratiod.get(&w.to_lowercase()).copied().unwrap_or(0);
                    (count as f32 / total_i as f32) < 0.3
                })
                .collect::<Vec<_>>()
                .join(" ");
            issue_headers.push_str("- ");
            issue_headers.push_str(&ratiod_title);
            issue_headers.push('\n');
            github_ids.push(issues[by_index].external_github_id.clone());
        }

        
        let centroid = {
            let members: Vec<Array1<f32>> = issue_ids
                .iter()
                .filter_map(|id| {
                    topic_labels_cache.iter().find(|(_, _, eid)| eid == id).map(|(_, _, _)| {
                        let row = rows.iter().find(|r| {
                            let eid: String = r.try_get("external_id").unwrap_or_default();
                            &eid == id
                        });
                        row.and_then(|r| {
                            let bytes: Vec<u8> = r.try_get("vector").ok()?;
                            Some(load_tokens(&bytes))
                        })
                    }).flatten()
                })
                .collect();
            if members.is_empty() {
                Array1::zeros(768)
            } else {
                let sum = members.iter().fold(Array1::zeros(768), |acc, v| acc + v);
                let mag = sum.dot(&sum).sqrt();
                if mag == 0.0 { sum } else { sum / mag }
            }
        };

        let label = label_cluster_from_blob(&app, &centroid, &topic_labels_blob);

        result.push(TopicBuckets {
            label,
            issue_ids: github_ids,
        });
    }

    Ok(result)
}

// For coastline ui
#[tauri::command]
async fn find_orbiters(
    pool: State<'_, SqlitePool>,
    coastline_id: String,
    planet_ids: Vec<String>,
    threshold: f32,
) -> Result<HashMap<String, String>, String> {
        // Load planet vectors
    let mut planet_vectors: Vec<(String, Array1<f32>)> = Vec::new();
    for pid in &planet_ids {
        let row = query("SELECT vector FROM coastline_embeddings WHERE source_id = ?")
            .bind(pid)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| e.to_string())?;
        if let Some(row) = row {
            let bytes: Vec<u8> = row.try_get("vector").map_err(|e| e.to_string())?;
            let vec = load_tokens(&bytes);
            planet_vectors.push((pid.clone(), vec));
        }
    }

    // Load all other source vectors for this coastline that aren't planets
    // NOTE: SQLX doesn't support variable-length lists so we need to pass formatted statement
    let placeholders = planet_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let statement = format!(
        r#"
        SELECT ce.source_id, ce.vector
        FROM coastline_embeddings ce
        JOIN coastline_concern_sources ccs ON ccs.id = ce.source_id
        WHERE ccs.coastline_id = ?
        AND ce.source_id NOT IN ({})
        "#,
        placeholders
    );

    let mut q = query(&statement).bind(&coastline_id);
    for pid in &planet_ids {
        q = q.bind(pid);
    }

    let rows = q.fetch_all(&*pool).await.map_err(|e| e.to_string())?;

    let mut result: HashMap<String, String> = HashMap::new();

    for row in rows {
        let source_id: String = row.try_get("source_id").map_err(|e| e.to_string())?;
        let bytes: Vec<u8> = match row.try_get("vector") {
            Ok(b) => b,
            Err(_) => continue,
        };
        let vec = load_tokens(&bytes);

        let mut best_sim = threshold;
        let mut best_planet_id: Option<String> = None;

        for (pid, pvec) in &planet_vectors {
            let sim = vec.dot(pvec);
            if sim > best_sim {
                best_sim = sim;
                best_planet_id = Some(pid.clone());
            }
        }

        if let Some(pid) = best_planet_id {
            result.insert(source_id, pid);
        }
    }

    Ok(result)
}

// PERF: Our ndarray wrapper
fn load_tokens(bytes: &[u8]) -> Array1<f32> {
    let a = Array1::from(
        bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect::<Vec<f32>>(),
    );
    let mag = a.dot(&a).sqrt();
    if mag == 0.0 { a } else { a / mag }
}

// TODO: A task that finds the surface of each planet
// then vector origins and tips within the planet surface
// Including finding danglers and re-matching them
// Replaced by PCA + DBSCAN in find_coastline_topics — kept for reference
fn run_kmeans(vectors: &[Array1<f32>], n_clusters: usize) -> Vec<usize> {
    let total_i = vectors.len();
    let total_b = n_clusters;

    let mut random_seed = SmallRng::seed_from_u64(42);
    let first_planet = random_seed.random_range(0..total_i); // fixed seed — deterministic cluster init
    let mut planets: Vec<Array1<f32>> = vec![vectors[first_planet].clone()];

    while planets.len() < total_b {
        let next = vectors
            .iter()
            .max_by(|a, b| {
                let min_sim_a = planets.iter().map(|p| a.dot(p)).fold(f32::MAX, f32::min);
                let min_sim_b = planets.iter().map(|p| b.dot(p)).fold(f32::MAX, f32::min);
                min_sim_b
                    .partial_cmp(&min_sim_a)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap();
        planets.push(next.clone());
    }

    let mut assignments = vec![0usize; total_i];

    for _ in 0..25 {
        let mut still_searching = false;
        for (i, vec) in vectors.iter().enumerate() {
            let best = planets
                .iter()
                .enumerate()
                .map(|(c, cv)| (c, vec.dot(cv)))
                .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(c, _)| c)
                .unwrap_or(0);
            if assignments[i] != best {
                assignments[i] = best;
                still_searching = true;
            }
        }

        let mut danglers = false;
        for bucket in 0..total_b {
            let members: Vec<&Array1<f32>> = vectors
                .iter()
                .enumerate()
                .filter(|(i, _)| assignments[*i] == bucket)
                .map(|(_, v)| v)
                .collect();
            if members.is_empty() {
                let furthest = vectors
                    .iter()
                    .enumerate()
                    .max_by(|(i, a), (j, b)| {
                        let dist_a = a.dot(&planets[assignments[*i]]);
                        let dist_b = b.dot(&planets[assignments[*j]]);
                        dist_b
                            .partial_cmp(&dist_a)
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .map(|(_, v)| v.clone())
                    .unwrap();
                planets[bucket] = furthest;
                danglers = true;
                continue;
            }

            let views: Vec<_> = members.iter().map(|v| v.view()).collect();
            let stacked = stack(Axis(0), &views).unwrap();
            let average = stacked.mean_axis(Axis(0)).unwrap();
            let boundary = average.dot(&average).sqrt();
            planets[bucket] = average / boundary;
        }

        if !still_searching && !danglers {
            break;
        }
    }

    assignments
}

// commands.rs
//
// Production replacements for every Ollama and OpenRouter tasks
//

use ndarray::{Array1, Array2, s, aview1};
use ort::{Environment, Session, SessionBuilder, Value};
use sqlx::{SqlitePool, query_as};
use tauri::{AppHandle, Manager, State};
use tokenizers::Tokenizer;
use std::sync::OnceLock;


static engine: OnceLock<Environment> = OnceLock::new();

fn start_env() -> &'static Environment {
    engine.get_or_init(|| {
        Environment::builder()
            .with_name("drydock")
            .build()
            .expect("There was a problem when starting the engine")
    })
}

// Produces a 768-dim normalised embedding vector from input text.
// Uses nomic-embed-text.onnx and its tokenizer.json from Tauri resources.
fn embed_text(app: &AppHandle, text: &str) -> Result<Vec<f32>, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;

    let model_path = resources.join("nomic-embed-text.onnx");
    let tp = resources.join("tokeniser.json");

    let tokeniser = Tokenizer::from_file(&tp)
        .map_err(|e| format!("Tokeniser load failed: {}", e))?;

    let encoding = tokeniser
        .encode(text, true)
        .map_err(|e| format!("Tokenise failed: {}", e))?;

    let ids: Vec<i64> = encoding.get_ids().iter().map(|&x| x as i64).collect();
    let mask: Vec<i64> = encoding.get_attention_mask().iter().map(|&x| x as i64).collect();
    let type_ids: Vec<i64> = encoding.get_type_ids().iter().map(|&x| x as i64).collect();

    let seq_len = ids.len();

    let ids_array = Array2::from_shape_vec((1, seq_len), ids)
        .map_err(|e| e.to_string())?;
    let mask_array = Array2::from_shape_vec((1, seq_len), mask)
        .map_err(|e| e.to_string())?;
    let type_ids_array = Array2::from_shape_vec((1, seq_len), type_ids)
        .map_err(|e| e.to_string())?;

    let session = SessionBuilder::new(start_env())
        .map_err(|e| e.to_string())?
        .with_model_from_file(&model_path)
        .map_err(|e| format!("Model load failed: {}", e))?;

    let outputs = session
        .run(vec![
            Value::from_array(session.allocator(), &ids_array).map_err(|e| e.to_string())?,
            Value::from_array(session.allocator(), &mask_array).map_err(|e| e.to_string())?,
            Value::from_array(session.allocator(), &type_ids_array).map_err(|e| e.to_string())?,
        ])
        .map_err(|e| format!("ONNX inference failed: {}", e))?;

    let tensor = outputs[0]
        .try_extract::<f32>()
        .map_err(|e| e.to_string())?;
    let view = tensor.view();
    let shape = view.shape();

    let pooled: Vec<f32> = (0..shape[2])
        .map(|dim| {
            (0..shape[1]).map(|tok| view[[0, tok, dim]]).sum::<f32>() / shape[1] as f32
        })
        .collect();

    let mag: f32 = pooled.iter().map(|x| x * x).sum::<f32>().sqrt();
    let normalised = if mag == 0.0 {
        pooled
    } else {
        pooled.iter().map(|x| x / mag).collect()
    };

    Ok(normalised)
}

// Enshittified but TODO

#[tauri::command]
pub async fn claim_guide(user_message: String) -> Result<String, String> {
    Ok(user_message.trim().to_string())
}

// Topic flavouring

#[tauri::command]
pub async fn flavour_topic(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    claim: String,
    description: String,
) -> Result<TopicNature, String> {
    let rows: Vec<(String, String, Vec<u8>)> = query_as(
        "SELECT frequency, confidence, embedding
         FROM chatter_library
         WHERE embedding IS NOT NULL"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        return Ok(TopicNature {
            frequency: "low".to_string(),
            confidence: "low".to_string(),
            reasoning: None,
        });
    }

    let query_text = format!("{} {}", claim, description);
    let query_vec = embed_text(&app, &query_text)?;

    let mut scored: Vec<(String, String, f32)> = rows
        .into_iter()
        .map(|(freq, conf, embedding)| {
            let vec = load_tokens(&embedding);
            let sim = aview1(&query_vec).dot(&vec);
            (freq, conf, sim)
        })
        .collect();

    scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    let (freq, conf, _) = &scored[0];
    Ok(TopicNature {
        frequency: freq.clone(),
        confidence: conf.clone(),
        reasoning: None,
    })
}

// Search stategy recommender
#[tauri::command]
pub async fn suggest_keywords(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    claim: String,
    description: String,
    _frequency: String,
) -> Result<Vec<String>, String> {
    let rows: Vec<(String, Vec<u8>)> = query_as(
        "SELECT phrase, embedding
         FROM vocabulary_blobs
         WHERE embedding IS NOT NULL"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        return Ok(vec![]);
    }

    let query_text = format!("{} {}", claim, description);
    let query_vec = embed_text(&app, &query_text)?;

    let mut scored: Vec<(String, f32)> = rows
        .into_iter()
        .map(|(phrase, embedding)| {
            let vec = load_tokens(&embedding);
            let sim = aview1(&query_vec).dot(&vec);
            (phrase, sim)
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    Ok(scored.into_iter().take(5).map(|(p, _)| p).collect())
}

// Intelligent search strategy redirection
#[tauri::command]
pub async fn refresh_search_strategy(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    _bet_id: String,
    claim: String,
    _proves_right: String,
    _proves_wrong: String,
    current_keywords: Vec<String>,
) -> Result<Vec<String>, String> {
    let rows: Vec<(String, Vec<u8>)> = query_as(
        "SELECT phrase, embedding
         FROM vocabulary_blobs
         WHERE embedding IS NOT NULL"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        return Ok(current_keywords);
    }

    let query_vec = embed_text(&app, &claim)?;

    let mut scored: Vec<(String, f32)> = rows
        .into_iter()
        .map(|(phrase, embedding)| {
            let vec = load_tokens(&embedding);
            let sim = aview1(&query_vec).dot(&vec);
            (phrase, sim)
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    Ok(scored.into_iter().take(5).map(|(p, _)| p).collect())
}

// Find coastline topics
pub fn label_cluster_from_blob(
    app: &AppHandle,
    centroid: &Array1<f32>,
    topic_labels: &[(String, Vec<u8>)],
) -> String {
  

    let mut scored: Vec<(&str, f32)> = topic_labels
        .iter()
        .map(|(label, embedding)| {
            let vec = load_tokens(embedding);
            let sim = centroid.dot(&vec);
            (label.as_str(), sim)
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    scored[0].0.to_string()
}

// Match orphan to topic
pub fn pick_best_match(
    scored: &[(String, String, f32)],
    top5: &[serde_json::Value],
) -> Option<serde_json::Value> {
    scored.first().map(|(num, title, _)| {
        serde_json::json!({ "issueNumber": num, "issueTitle": title })
    })
}

fn main() {
    use tauri_plugin_sql::Builder;

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(Builder::default().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db_url = format!("sqlite:{}/drydock.db", data_dir.to_string_lossy());
            let pool = tauri::async_runtime::block_on(SqlitePool::connect(&db_url))?;
            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            batter_up,
            trawl_bsky,
            fetch_bluesky_posts,
            fetch_hn_posts,
            get_settings,
            push_settings,
            delete_settings,
            load_theme,
            save_theme,
            starter_draft,
            match_orphan_to_issue,
            scout_network,
            release_commands::claim_guide,
            release_commands::flavour_topic,
            release_commands::suggest_keywords,
            release_commands::refresh_search_strategy,
            match_evidence_to_blocks,
            find_coastline_topics,
            find_orbiters,
            send_to_nomic
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
