# FVN.li Discord Bot

## What does it do?

The Discord bot for [FVN.li](https://github.com/AkibaAT/fvn.li). It searches the visual novel catalog and sends game update notifications.

### Current Functionality:

* `/search` - Search for visual novels by name, returns matches with version, word count, last updated, and links

The bot periodically polls the API for updates and notifies subscribed users.

## Running

```bash
docker compose up -d
```

## Configuration
The following environment variables must be set before starting the application:

**FVN.li API Configuration:**
* `LARAVEL_API_URL` - URL of the FVN.li API
* `LARAVEL_API_TOKEN` - Your API token for accessing the FVN.li API

**Discord Configuration:**
* `DISCORD_API_KEY` - Bot token from Discord Developer Portal
* `DISCORD_ADMIN_ID` - Discord user ID that receives the simple feed of every watched game update, addition request, and review report
* `DISCORD_ADMIN_NOTIFICATIONS_CHANNEL_ID` - Optional channel ID that mirrors the admin update feed

**Optional development mode:**
* `DISCORD_DEV_MODE` - Set to `true` to restrict Discord deliveries
* `DISCORD_DEV_USER_IDS` - Comma-separated Discord user IDs allowed to receive DMs in development mode
* `DISCORD_DEV_GUILD_IDS` - Comma-separated Discord guild IDs allowed to receive channel messages in development mode

In development mode, only listed users and guilds receive messages, including `/notifications test`. An empty list allows no deliveries. Suppressed DMs can be retried; admin alerts stay queued until the admin is allowed.

The API handles retries. For server messages, a failed delivery confirmation does not trigger another send. Restarting the bot can still cause duplicates.

## Project Structure

```
src/
├── index.ts              # Main entry point
├── config.ts             # Environment configuration
├── commands/
│   ├── index.ts          # Command registry
│   └── search.ts         # /search command
├── events/
│   └── handlers.ts       # Discord event handlers
└── services/
    ├── api.ts            # Laravel API client
    └── notifications.ts  # Notification polling service
```

## Adding New Commands

Create a new file in `src/commands/` following this pattern:

```typescript
import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from './index.ts';

export const myCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('mycommand')
    .setDescription('Description here'),

  async execute(interaction: ChatInputCommandInteraction) {
    // Handle command
  },
};
```

Then register it in `src/events/handlers.ts`.

## Related Projects

This bot works in conjunction with:

* [FVN.li](https://github.com/AkibaAT/fvn.li) - A Laravel application that handles the indexing and metadata processing
