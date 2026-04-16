# Smart Memory System

Clover stores compact memory snippets instead of full history.

## Extraction
- After each user message, Clover extracts short preference/fact snippets (e.g., "I like matcha", "I prefer evening study sessions").
- Duplicate snippets are deduplicated per user.

## Injection
- On future messages, Clover ranks stored snippets by keyword overlap with the new input.
- Top relevant memories are injected into the AI system prompt for personalization.

## Admin Management
- Admin dashboard includes memory browsing and editing via `/api/admin/memories` endpoints.
