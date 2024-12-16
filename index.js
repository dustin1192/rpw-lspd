require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require('discord.js');
const { setChannelCommand, loadSettings, handleInteraction } = require('./modules/start');
const { setDepartmentRoleCommand, calloutCommand, handleModalSubmit } = require('./modules/callouts');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ]
});

client.commands = new Collection();

client.commands.set(setChannelCommand.name, setChannelCommand);
client.commands.set(setDepartmentRoleCommand.name, setDepartmentRoleCommand);
client.commands.set(calloutCommand.name, calloutCommand);

client.once('ready', async () => {
    console.log(`Бот ${client.user.tag} успешно запущен!`);

    try {
        loadSettings(client);
    } catch (error) {
        console.error('Ошибка при загрузке настроек:', error);
    }
    const commands = [
        setChannelCommand,
        setDepartmentRoleCommand,
        calloutCommand
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Регистрация глобальных команд...');

        // Регистрация глобальных команд
        await rest.put(Routes.applicationCommands(client.user.id), {
            body: commands,
        });

        console.log('Глобальные команды успешно зарегистрированы.');
    } catch (error) {
        console.error('Ошибка при регистрации глобальных команд:', error);
    }

    client.user.setPresence({
        activities: [{
            name: '> Доступен.',
            type: ActivityType.Custom,
        }],
        status: 'online'
    });
});


client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) {
            console.error(`Команда ${interaction.commandName} не найдена.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Ошибка при выполнении команды ${interaction.commandName}:`, error);
            await interaction.reply({ content: 'Произошла ошибка при выполнении команды.', ephemeral: true });
        }
    }

    if (interaction.isModalSubmit()) {
        try {
            await handleModalSubmit(interaction);
        } catch (error) {
            console.error('Ошибка при обработке модального окна:', error);
        }
    }

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        try {
            await handleInteraction(interaction, client);
        } catch (error) {
            console.error('Ошибка при обработке взаимодействия:', error);
            await interaction.reply({ content: 'Произошла ошибка при обработке взаимодействия.', ephemeral: true });
        }
    }

    if (interaction.isButton() && interaction.customId === 'code4') {
        try {
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('code4')
                    .setLabel('CODE 4')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(true)
            );

            await interaction.update({
                content: `Ситуация разрешена, тред закрыт пользователем <@${interaction.user.id}>.`,
                components: [disabledRow]
            });

            const thread = interaction.channel;
            if (thread.isThread()) {
                await thread.setArchived(true);
            } else {
                await interaction.followUp({ content: 'Это не тред.', ephemeral: true });
            }

        } catch (error) {
            console.error('Ошибка при обработке нажатия на кнопку:', error);
            if (!interaction.replied) {
                await interaction.reply({ content: 'Не удалось закрыть тред. Попробуйте еще раз.', ephemeral: true });
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
