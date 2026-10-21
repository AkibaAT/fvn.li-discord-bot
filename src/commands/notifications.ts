import type {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from 'discord.js';
import {ApplicationIntegrationType, InteractionContextType} from 'discord-api-types/v10';
import type {Command} from './index.ts';
import {api} from '../services/api.ts';
import {NotificationService} from '../services/notifications.ts';

export const notificationsCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('notifications')
        .setDescription('Test and inspect FVN.li direct-message notifications')
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .addSubcommand((command) => command.setName('test').setDescription('Send yourself a direct-message delivery test'))
        .addSubcommand((command) => command.setName('status').setDescription('Show notification authorization status')),

    async execute(interaction: ChatInputCommandInteraction) {
        const subcommand = interaction.options.getSubcommand(true);
        await interaction.deferReply({ephemeral: true});

        if (subcommand === 'status') {
            const userInstalled =
                interaction.authorizingIntegrationOwners?.[ApplicationIntegrationType.UserInstall] === interaction.user.id;
            await interaction.editReply(
                userInstalled
                    ? 'The FVN.li app is user-installed for your account. Run `/notifications test` to verify direct-message delivery.'
                    : 'The FVN.li app is not detected as user-installed in this context. Authorize the user install from your FVN.li notification settings, then run `/notifications test`.',
            );
            return;
        }

        const outcome = await new NotificationService(interaction.client).testDm(interaction.user.id);
        let recorded = false;
        try {
            const response = await api.verifyDm(interaction.user.id, outcome.success, outcome.errorCode, outcome.retryable);
            recorded = response.success;
        } catch (error) {
            console.error('[notifications test] Failed to report DM verification:', error);
        }

        let reply: string;
        if (outcome.success && recorded) {
            reply = 'Test DM delivered. FVN.li has marked Discord notifications as deliverable.';
        } else if (outcome.success) {
            reply = 'Test DM delivered, but FVN.li could not save the result. Check that this Discord account is linked, then retry.';
        } else if (outcome.retryable) {
            reply = `The test could not finish (${outcome.errorCode ?? 'temporary error'}). Your notification authorization is unchanged. Please retry later.`;
        } else {
            reply = `Discord could not deliver the test DM (${outcome.errorCode ?? 'unknown'}). Check the user install, privacy settings, and blocked-app list, then retry.`;
        }

        await interaction.editReply(reply);
    },
};
