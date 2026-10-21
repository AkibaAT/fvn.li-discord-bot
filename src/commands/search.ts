import type {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from 'discord.js';
import {ApplicationIntegrationType, InteractionContextType} from 'discord-api-types/v10';
import {api, extractUrl} from '../services/api.ts';
import type {Command} from './index.ts';
import {truncateMessage} from '../services/message-content.ts';

export const searchCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for visual novels by name')
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .addStringOption((option) => option.setName('name').setDescription('Game name to search').setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
        const name = interaction.options.getString('name', true);

        await interaction.deferReply();
        const reply = (content: string) => interaction.editReply({content: truncateMessage(content), allowedMentions: {parse: []}});

        const username = interaction.user.username;
        console.log(`[Search] Query: "${name}" (user: ${username})`);

        try {
            const result = await api.search(name);

            if (result.matches === 0) {
                await reply(`Found no matches for "${name}"`);
                return;
            }

            const games = result.games;
            const singleResult = games.length === 1;

            let response = `**Found ${result.matches} matches for "${name}":**\n`;

            for (const game of games) {
                const version = game.version ?? 'unknown';
                const wordCount = game.english_word_count ? `, ${game.english_word_count.toLocaleString()} words` : '';
                const lastUpdated = game.published_at ? `, updated <t:${Math.floor(game.published_at)}:R>` : '';
                const gameUrl = extractUrl(game.url);
                const primaryUrl = game.primary_url ? `\n<${game.primary_url}>` : '';

                if (singleResult) {
                    response += `**${game.name}** (v${version}${wordCount}${lastUpdated})\n${gameUrl}${primaryUrl}\n\n`;
                } else {
                    response += `**${game.name}** (v${version}${wordCount}${lastUpdated})\n<${gameUrl}>${primaryUrl}\n\n`;
                }
            }

            if (games.length >= 10 && result.search_url) {
                response += `[View all results](${result.search_url})`;
            }

            if (response.length > 2000) {
                let suffix = '\n\n… results truncated';
                if (result.search_url) {
                    suffix += ` — [view all](${result.search_url})`;
                }
                let body = response.slice(0, 2000 - suffix.length);
                const lastBreak = body.lastIndexOf('\n\n');
                if (lastBreak > 0) {
                    body = body.slice(0, lastBreak);
                }
                response = body + suffix;
            }

            console.log(`[Search] Response length: ${response.length} chars`);
            await reply(response);
        } catch (error) {
            console.error(`[Search] API error:`, error);
            await reply(`An unexpected error occurred while searching for "${name}"`);
        }
    },
};
