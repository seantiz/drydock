-- predictions table
CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,
    codename TEXT,
    claim TEXT NOT NULL,
    description TEXT NOT NULL,
    made_at DATETIME NOT NULL,
    target_date DATETIME,
    initial_confidence INTEGER NOT NULL,
    current_confidence INTEGER NOT NULL,
    maturity TEXT NOT NULL,
    mission_status TEXT DEFAULT 'dormant',
    blog_post_url TEXT,
    firehose_filters TEXT,
    topic TEXT NOT NULL DEFAULT '{"frequency":"low","confidence":"low"}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- evidence table
CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    prediction_id TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    snippet TEXT NOT NULL,
    captured_at DATETIME NOT NULL,
    sentiment TEXT,
    weight INTEGER NOT NULL,
    language TEXT,
    times_used INTEGER NOT NULL DEFAULT 0,
    coastline_id TEXT REFERENCES coastlines(id),
    source_created_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
);

-- pending_signals table
CREATE TABLE IF NOT EXISTS pending_signals (
    id TEXT PRIMARY KEY,
    prediction_id TEXT NOT NULL,
    post_uri TEXT NOT NULL,
    author TEXT NOT NULL,
    author_avatar TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    captured_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    keyword_matches INTEGER NOT NULL DEFAULT 0,
    post_url TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'bluesky',
    FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
);

-- publications table for outbox
CREATE TABLE IF NOT EXISTS publications (
    id TEXT PRIMARY KEY,
    prediction_id TEXT NOT NULL,
    format TEXT NOT NULL,
    generated_at DATETIME NOT NULL,
    content TEXT NOT NULL,
    blocks TEXT,
    posted_url TEXT,
    FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
);

-- user journey table
CREATE TABLE IF NOT EXISTS user_journey (
    id TEXT PRIMARY KEY,
    first_time_user BOOLEAN NOT NULL DEFAULT TRUE,
    platform TEXT NOT NULL,
    voice TEXT NOT NULL,
    audience TEXT NOT NULL,
    output_formats TEXT NOT NULL DEFAULT '["blog"]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- dismissed_signals table
CREATE TABLE IF NOT EXISTS dismissed_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id TEXT NOT NULL,
    post_uri TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'bluesky',
    dismissed_at DATETIME NOT NULL,
    FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
);

-- Coastline tables
CREATE TABLE IF NOT EXISTS coastlines (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	repo_url TEXT NOT NULL UNIQUE,
	owner TEXT NOT NULL,
	repo TEXT NOT NULL,
	description TEXT,
	last_fetched_at DATETIME,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coastline_concern_sources (
	id TEXT PRIMARY KEY,
	coastline_id TEXT NOT NULL,
	signal_type TEXT NOT NULL,
	concern TEXT NOT NULL,
	external_id TEXT,
	title TEXT,
	body TEXT,
	url TEXT,
	state TEXT,
	author TEXT,
	created_at_source DATETIME,
	updated_at_source DATETIME,
	fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	refs TEXT,
	labels TEXT,
	FOREIGN KEY (coastline_id) REFERENCES coastlines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS coastline_embeddings (
	source_id TEXT PRIMARY KEY,
	vector BLOB NOT NULL,
	embedded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- dev mode

-- Community chatter tables (dev)

CREATE TABLE IF NOT EXISTS chatter_library (
	id TEXT PRIMARY KEY,
	text TEXT NOT NULL,
	frequency TEXT NOT NULL,
	confidence TEXT NOT NULL,
	embedding BLOB,
	embedded_at DATETIME,
	added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Topical breakdown of a coastline
CREATE TABLE IF NOT EXISTS coastline_topics (
    coastline_id TEXT NOT NULL,
    cluster_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    issue_ids TEXT NOT NULL,
    clustered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (coastline_id, cluster_id),
    FOREIGN KEY (coastline_id) REFERENCES coastlines(id) ON DELETE CASCADE
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_predictions_maturity ON predictions(maturity);
CREATE INDEX IF NOT EXISTS idx_predictions_mission_status ON predictions(mission_status);
CREATE INDEX IF NOT EXISTS idx_evidence_prediction_id ON evidence(prediction_id);
CREATE INDEX IF NOT EXISTS idx_evidence_source ON evidence(source);
CREATE INDEX IF NOT EXISTS idx_evidence_sentiment ON evidence(sentiment);
CREATE INDEX IF NOT EXISTS idx_evidence_captured_at ON evidence(captured_at);
CREATE INDEX IF NOT EXISTS idx_pending_signals_prediction_id ON pending_signals(prediction_id);
CREATE INDEX IF NOT EXISTS idx_pending_signals_expires_at ON pending_signals(expires_at);
CREATE INDEX IF NOT EXISTS idx_dismissed_signals_prediction_id ON dismissed_signals(prediction_id);
CREATE INDEX IF NOT EXISTS idx_ccs_coastline_id ON coastline_concern_sources(coastline_id);
CREATE INDEX IF NOT EXISTS idx_ccs_concern ON coastline_concern_sources(concern);
CREATE INDEX IF NOT EXISTS idx_ccs_signal_type ON coastline_concern_sources(signal_type);
