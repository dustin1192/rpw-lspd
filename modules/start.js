const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionsBitField,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

const MAX_PATROL_TIME = 1 * 60 * 60 * 1000;
const QUEUE_TIMEOUT = 3 * 60 * 60 * 1000; // 3 часа
let activePatrols = new Map();
let queueTimers = new Map();

let FTO_ROLE_ID = null;
let TRAINEE_ROLE_ID = null;

let traineeQueue = [];
let ftoQueue = [];

let PATROL_CHANNEL_ID = null;
let EMBED_CHANNEL_ID = null;

function loadSettings(client) {
    if (!fs.existsSync(SETTINGS_FILE)) {
        console.warn('Файл настроек не найден. Создаётся новый файл...');
        const defaultSettings = {
            PATROL_CHANNEL_ID: null,
            EMBED_CHANNEL_ID: null,
            FTO_ROLE_ID: null,
            TRAINEE_ROLE_ID: null,
            activePatrols: {},
        };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
        console.log('Новый файл настроек создан.');
        return;
    }

    const rawData = fs.readFileSync(SETTINGS_FILE);
    const settings = JSON.parse(rawData);

    PATROL_CHANNEL_ID = settings.PATROL_CHANNEL_ID;
    EMBED_CHANNEL_ID = settings.EMBED_CHANNEL_ID;
    FTO_ROLE_ID = settings.FTO_ROLE_ID;
    TRAINEE_ROLE_ID = settings.TRAINEE_ROLE_ID;

    if (settings.activePatrols) {
        for (const [threadId, startTime] of Object.entries(settings.activePatrols)) {
            activePatrols.set(threadId, startTime);
            restorePatrolTimer(client, threadId, startTime);
        }
    }
}



function saveSettings() {
    const settings = {
        PATROL_CHANNEL_ID,
        EMBED_CHANNEL_ID,
        FTO_ROLE_ID,
        TRAINEE_ROLE_ID,
        activePatrols: Object.fromEntries(activePatrols)
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function updateQueueEmbed() {
    const embed = new EmbedBuilder()
        .setTitle('FTO Search')
        .setThumbnail('https://i.imgur.com/4LhIQRb.png')
        .setColor('#303136')
        .setImage('https://i.imgur.com/Uo2v3hp.png')
        .setFooter({ text: `Los Santos Police Department. Разработчик: dustin, специально для RPW.` })
        .setDescription('Этот модуль бота предназначен для поиска наставника или стажера. Выбрав соответствующий пункт в меню - вы встанете в очередь или сразу переключитесь на свободного наставника. Учтите, что очередь очищается каждые три часа.');

    if (traineeQueue.length > 0) {
        embed.addFields({
            name: 'Стажеры в очереди',
            value: traineeQueue.map((trainee, index) => `${index + 1}. <@${trainee.id}>`).join('\n'),
            inline: false,
        });
    } else {
        embed.addFields({
            name: 'Стажеры в очереди',
            value: 'Нет стажеров в очереди',
            inline: false,
        });
    }

    if (ftoQueue.length > 0) {
        embed.addFields({
            name: 'Свободные FTO',
            value: ftoQueue.map((fto, index) => `${index + 1}. <@${fto.id}>`).join('\n'),
            inline: false,
        });
    } else {
        embed.addFields({
            name: 'Свободные FTO',
            value: 'Нет FTO',
            inline: false,
        });
    }

    return embed;
}

function addToQueueWithTimeout(user, queue, client) {
    queue.push(user);

    const timer = setTimeout(() => {
        removeFromQueueAfterTimeout(user, queue, client);
        queueTimers.delete(user.id);
    }, QUEUE_TIMEOUT);

    queueTimers.set(user.id, timer);
}

async function removeFromQueueAfterTimeout(user, queue, client) {
    const index = queue.findIndex(member => member.id === user.id);
    if (index !== -1) {
        queue.splice(index, 1);
        await updateQueueEmbedInChannel(client);
    }
}

async function updateQueueEmbedInChannel(client) {
    const embedChannel = await client.channels.fetch(EMBED_CHANNEL_ID);
    const lastMessage = (await embedChannel.messages.fetch({ limit: 1 })).first();

    if (lastMessage) {
        const embed = updateQueueEmbed();
        await lastMessage.edit({ embeds: [embed] });
    } else {
        const embed = updateQueueEmbed();
        await embedChannel.send({ embeds: [embed] });
    }
}

function removeFromQueue(userId, queue) {
    const index = queue.findIndex(member => member.id === userId);

    if (index !== -1) {
        queue.splice(index, 1);
        const timer = queueTimers.get(userId);

        if (timer) {
            clearTimeout(timer);
            queueTimers.delete(userId);
        }

        return true;
    }
    return false;
}
function restorePatrolTimer(client, threadId, startTime) {
    const elapsedTime = Date.now() - startTime;
    const remainingTime = MAX_PATROL_TIME - elapsedTime;

    if (remainingTime <= 0) {
        const thread = client.channels.cache.get(threadId);
        if (thread) {
            endPatrol(thread, null, 'Патруль завершен автоматически после перезапуска бота');
        }
    } else {
        setTimeout(() => {
            const thread = client.channels.cache.get(threadId);
            if (thread) {
                endPatrol(thread, null, 'Патруль завершен автоматически через 5 часов');
            }
        }, remainingTime);
    }
}
async function startPatrol(thread, interaction) {
    if (activePatrols.has(thread.id)) {
        await interaction.reply({ content: 'Патруль уже начат.', ephemeral: true });
        return;
    }

    const startTime = Date.now();
    activePatrols.set(thread.id, startTime);
    saveSettings();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('start_patrol')
            .setLabel('Начать патруль')
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('end_patrol')
            .setLabel('Закончить патруль')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(false)
    );

    await interaction.message.edit({ components: [row] });
    await interaction.reply({ content: 'Патруль начат.', ephemeral: true });

    setTimeout(async () => {
        if (activePatrols.has(thread.id)) {
            await endPatrol(thread, interaction, 'Патруль завершен автоматически через 5 часов');
        }
    }, MAX_PATROL_TIME);
}

async function endPatrol(thread, interaction, reason = 'Патруль завершен') {
    const startTime = activePatrols.get(thread.id);
    if (startTime) {
        const endTime = Date.now();
        const duration = Math.round((endTime - startTime) / 1000 / 60);
        await thread.send(`${reason}. Патруль длился ${duration} минут. Завершил: <@${interaction.user.id}>`);
        activePatrols.delete(thread.id);
        saveSettings();
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('start_patrol')
            .setLabel('Начать патруль')
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('end_patrol')
            .setLabel('Закончить патруль')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true)
    );

    if (interaction) {
        await interaction.reply({ content: 'Патруль завершен.', ephemeral: true });
        await interaction.message.edit({ components: [row] });
    }

    await thread.setArchived(true);
    await updateQueueEmbedInChannel(thread.client);
}


const setChannelCommand = {
    name: 'setchannel',
    description: 'Устанавливает каналы для Embed сообщений, сообщений о патруле и роли для FTO и стажеров',
    options: [
        {
            name: 'embed_channel',
            type: 7, // Channel type
            description: 'Канал для отправки информационного сообщения',
            required: true,
        },
        {
            name: 'patrol_channel',
            type: 7, // Channel type
            description: 'Канал для отправки тредов о начале патруля',
            required: true,
        },
        {
            name: 'fto_role',
            type: 8, // role type
            description: 'Роль для FTO',
            required: true,
        },
        {
            name: 'trainee_role',
            type: 8, // role type
            description: 'Роль для стажеров',
            required: true,
        }
    ],
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'У вас нет прав на использование этой команды.', ephemeral: true });
        }

        const embedChannel = interaction.options.getChannel('embed_channel');
        const patrolChannel = interaction.options.getChannel('patrol_channel');
        const ftoRole = interaction.options.getRole('fto_role');
        const traineeRole = interaction.options.getRole('trainee_role');

        if (!embedChannel || !patrolChannel || !ftoRole || !traineeRole) {
            return interaction.reply({ content: 'Все параметры команды должны быть указаны.', ephemeral: true });
        }

        if (embedChannel && embedChannel.isTextBased() && patrolChannel && patrolChannel.isTextBased()) {
            EMBED_CHANNEL_ID = embedChannel.id;
            PATROL_CHANNEL_ID = patrolChannel.id;
            FTO_ROLE_ID = ftoRole.id;
            TRAINEE_ROLE_ID = traineeRole.id;

            saveSettings();

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select')
                    .setPlaceholder('Выберите действие')
                    .addOptions([
                        {
                            label: 'Встать в очередь или найти FTO',
                            description: 'Police Officer I',
                            value: 'find_fto',
                            emoji: '🕵️‍♂️',
                        },
                        {
                            label: 'Взять стажера',
                            description: 'Police Officer III, Sergeant',
                            value: 'find_trainee',
                            emoji: '👨‍🎓',
                        },
                    ])
            );

            const cancelRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cancel')
                    .setLabel('Выйти с очереди')
                    .setStyle(ButtonStyle.Danger)
            );

            const embed = updateQueueEmbed();
            await embedChannel.send({ embeds: [embed], components: [row, cancelRow] });
            await interaction.reply(`Каналы и роли успешно настроены. Embed сообщения будут отправляться в <#${embedChannel.id}>, а сообщения о патрулях в <#${patrolChannel.id}>. Роль FTO: <@&${ftoRole.id}>, Роль стажеров: <@&${traineeRole.id}>.`);
        } else {
            await interaction.reply('Пожалуйста, укажите текстовые каналы для Embed сообщений и сообщений о патрулях, а также корректные роли.');
        }
    },
};

async function handleInteraction(interaction, client) {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    const user = interaction.user;
    const memberRoles = interaction.member.roles.cache;

    if (!PATROL_CHANNEL_ID) {
        await interaction.reply({ content: 'Канал для патрулей не настроен. Используйте команду /setchannel для настройки.', ephemeral: true });
        return;
    }

    const patrolChannel = await client.channels.fetch(PATROL_CHANNEL_ID);

    if (interaction.isButton()) {
        const thread = interaction.channel;

        if (interaction.customId === 'start_patrol') {
            await startPatrol(thread, interaction);
        } else if (interaction.customId === 'end_patrol') {
            await endPatrol(thread, interaction);
        } else if (interaction.customId === 'cancel') {
            await handleCancel(interaction, client);
        }

        return;
    }

    if (interaction.isStringSelectMenu() && interaction.values[0] === 'find_fto') {
        await interaction.deferReply({ ephemeral: true });
        if (memberRoles.has(TRAINEE_ROLE_ID)) {
            if (traineeQueue.some(trainee => trainee.id === user.id)) {
                await interaction.followUp({ content: 'Вы уже в очереди как стажер.', ephemeral: true });
                return;
            }

            if (ftoQueue.length === 0) {
                addToQueueWithTimeout(user, traineeQueue, client);
                await interaction.followUp({ content: `<@${user.id}> добавлен в очередь для поиска FTO.`, ephemeral: true });
                await updateQueueEmbedInChannel(client);
            } else {
                const fto = ftoQueue.shift();
                const traineeIndex = traineeQueue.findIndex(trainee => trainee.id === user.id);
                if (traineeIndex !== -1) {
                    traineeQueue.splice(traineeIndex, 1);
                }

                const patrolMessage = await patrolChannel.send(`Эй, <@${fto.id}>! На сегодня твой стажер - <@${user.id}>. Я создал тред для патруля. Не забудьте завершить патруль, чтобы закрыть тред.`);
                const thread = await patrolMessage.startThread({
                    name: `Соигроки: ${fto.username} и ${user.username}`,
                    autoArchiveDuration: 60,
                    reason: 'Новый патруль'
                });

                await updateQueueEmbedInChannel(client);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('start_patrol')
                        .setLabel('Начать патруль')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('end_patrol')
                        .setLabel('Закончить патруль')
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(true)
                );
                await thread.send({ content: 'Собираем сумки и снаряжение..', components: [row] });
                await interaction.followUp({ content: 'Вам найден FTO, посмотрите новый тред.', ephemeral: true });
            }
        } else {
            await interaction.followUp({ content: 'Только стажеры могут искать наставника.', ephemeral: true });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.values[0] === 'find_trainee') {
        await interaction.deferReply({ ephemeral: true });
        if (memberRoles.has(FTO_ROLE_ID)) {
            if (ftoQueue.some(fto => fto.id === user.id)) {
                await interaction.followUp({ content: 'Вы уже в очереди как FTO.', ephemeral: true });
                return;
            }

            if (traineeQueue.length === 0) {
                addToQueueWithTimeout(user, ftoQueue, client);
                await interaction.followUp({ content: `<@${user.id}> добавлен в очередь для поиска стажера.`, ephemeral: true });
                await updateQueueEmbedInChannel(client);
            } else {
                const trainee = traineeQueue.shift();
                const ftoIndex = ftoQueue.findIndex(fto => fto.id === user.id);
                if (ftoIndex !== -1) {
                    ftoQueue.splice(ftoIndex, 1);
                }

                const patrolMessage = await patrolChannel.send(`Эй, <@${user.id}>! На сегодня твой стажер - <@${trainee.id}>. Я создал тред для патруля. Не забудьте завершить патруль, чтобы закрыть тред.`);
                const thread = await patrolMessage.startThread({
                    name: `Соигроки: ${user.username} и ${trainee.username}`,
                    autoArchiveDuration: 60,
                    reason: 'Новый патруль'
                });

                await updateQueueEmbedInChannel(client);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('start_patrol')
                        .setLabel('Начать патруль')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('end_patrol')
                        .setLabel('Закончить патруль')
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(true)
                );
                await thread.send({ content: 'Собираем сумки и снаряжение..', components: [row] });
                await interaction.followUp({ content: 'Вам найден стажер, посмотрите новый тред.', ephemeral: true });
            }
        } else {
            await interaction.followUp({ content: 'Только наставники могут искать стажеров.', ephemeral: true });
        }
    }

    if (interaction.isButton() && interaction.customId === 'cancel') {
        await handleCancel(interaction, client);
    }
}

async function handleCancel(interaction, client) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const removedFromFto = removeFromQueue(interaction.user.id, ftoQueue);
        const removedFromTrainee = removeFromQueue(interaction.user.id, traineeQueue);

        if (!removedFromFto && !removedFromTrainee) {
            await interaction.followUp({ content: 'Вы не в очереди.', ephemeral: true });
        } else {
            await interaction.followUp({ content: 'Вы были удалены из очереди.', ephemeral: true });
            await updateQueueEmbedInChannel(client);
        }
    } catch (error) {
        console.error('Ошибка при нажатии на кнопку "отмена":', error);
        await interaction.followUp({ content: 'Произошла ошибка при удалении из очереди.', ephemeral: true });
    }
}

module.exports = {
    setChannelCommand,
    loadSettings,
    handleInteraction,
};
