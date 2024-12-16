const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    ActionRowBuilder,
    PermissionsBitField,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'callout_settings.json');

let calloutSettings = {};
function loadCalloutSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
        calloutSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE));
    }
}
loadCalloutSettings();

function saveCalloutSettings() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(calloutSettings, null, 2));
}

const setDepartmentRoleCommand = {
    name: 'setdepartmentrole',
    description: 'Настроить роли для отделов.',
    options: [
        {
            name: 'department',
            description: 'Выберите отдел для настройки роли',
            type: 3, // STRING
            required: true,
            choices: [
                { name: 'Supervisor', value: 'Supervisor' },
                { name: 'RHD', value: 'RHD' },
                { name: 'GND', value: 'GND' },
                { name: 'GED', value: 'GED' },
                { name: 'Platoon D', value: 'Platoon D' },
                { name: 'K9', value: 'K9' },
                { name: 'Platoon C', value: 'Platoon C' },
                { name: 'AIR Support', value: 'AIR Support' },
                { name: 'Internal Affairs', value: 'Internal Affairs' }
            ]
        },
        {
            name: 'role',
            description: 'Укажите роль для отдела',
            type: 8, // ROLE
            required: true
        },
        {
            name: 'image_url',
            description: 'Ссылка на изображение для миниатюры',
            type: 3, // STRING
            required: true
        }
    ],
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply({ content: 'У вас нет прав для выполнения этой команды. Только администраторы могут настраивать роли отделов.', ephemeral: true });
            return;
        }

        const department = interaction.options?.getString('department');
        const role = interaction.options?.getRole('role');
        const imageUrl = interaction.options.getString('image_url');

        if (!department || !role) {
            await interaction.reply({ content: 'Не удалось получить параметры команды.', ephemeral: true });
            return;
        }

        calloutSettings[department] = {
            roleId: role.id,
            imageUrl: imageUrl || null
        };
        saveCalloutSettings();

        await interaction.reply(`Роль для отдела **${department}** успешно настроена на <@&${role.id}>.`);
    }
};

const calloutCommand = {
    name: 'callouts',
    description: 'Запросить необходимый отдел или супервайзера.',
    options: [
        {
            name: 'department',
            description: 'Выберите, которому нужно отправить вызов',
            type: 3, // STRING
            required: true,
            choices: [
                { name: 'Супервайзер', value: 'Supervisor' },
                { name: 'RHD', value: 'RHD' },
                { name: 'GND', value: 'GND' },
                { name: 'GED', value: 'GED' },
                { name: 'Platoon D', value: 'Platoon D' },
                { name: 'K9', value: 'K9' },
                { name: 'Platoon C', value: 'Platoon C' },
                { name: 'AIR Support', value: 'AIR Support' },
                { name: 'Internal Affairs', value: 'Internal Affairs' }
            ]
        }
    ],
    async execute(interaction) {

        const department = interaction.options?.getString('department');

        if (!department) {
            await interaction.reply({ content: 'Не удалось получить отдел.', ephemeral: true });
            return;
        }

        if (!calloutSettings[department]) {
            await interaction.reply({ content: 'Роль для данного отдела не настроена.', ephemeral: true });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId(`callout_modal_${department}`)
            .setTitle(`Вызов отдела ${department}`);

        const callingUnit = new TextInputBuilder()
            .setCustomId('calling_unit')
            .setLabel('Вызывающий юнит')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('пример: 2A15')
            .setRequired(true);

        const location = new TextInputBuilder()
            .setCustomId('location')
            .setLabel('Локация')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('пример: 987, Alta St.')
            .setRequired(true);

        const situation = new TextInputBuilder()
            .setCustomId('situation')
            .setLabel('Описание ситуации')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('текст')
            .setRequired(true);

        const firstRow = new ActionRowBuilder().addComponents(callingUnit);
        const secondRow = new ActionRowBuilder().addComponents(location);
        const thirdRow = new ActionRowBuilder().addComponents(situation);

        modal.addComponents(firstRow, secondRow, thirdRow);

        await interaction.showModal(modal);
    }
};

const handleModalSubmit = async function(interaction, client) {
    try {
        const department = interaction.customId.split('_')[2];

        if (!department || !calloutSettings[department]) {
            await interaction.reply({ content: 'Не удалось определить отдел или роль для данного отдела не настроена.', ephemeral: true });
            return;
        }

        const callingUnit = interaction.fields.getTextInputValue('calling_unit');
        const location = interaction.fields.getTextInputValue('location');
        const situation = interaction.fields.getTextInputValue('situation');

        const departmentSettings = calloutSettings[department];
        const thumbnail = departmentSettings.imageUrl || 'https://i.imgur.com/KWZd1sl.png';

        const embed = new EmbedBuilder()
            .setTitle(`Вызов для: ${department}`)
            .setThumbnail(thumbnail)
            .setColor('#303136')
            .addFields(
                { name: 'Вызывающий юнит', value: callingUnit, inline: true },
                { name: 'Локация', value: location, inline: true },
                { name: 'Описание ситуации', value: situation }
            )
            .setTimestamp()
            .setFooter({ text: 'Los Santos Police Department' });

        const message = await interaction.reply({
            content: `<@&${departmentSettings.roleId}>`,
            embeds: [embed],
            fetchReply: true
        });

        const thread = await message.startThread({
            name: `Обсуждение от ${callingUnit}`,
            autoArchiveDuration: 60,
            reason: 'Создание треда для обсуждения вызова'
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('code4')
                .setLabel('CODE 4')
                .setStyle(ButtonStyle.Danger)
        );

        await thread.send({
            content: 'Если ситуация разрешена, нажмите "CODE 4", чтобы закрыть тред.',
            components: [row]
        });

    } catch (error) {
        console.error('Ошибка при обработке модального окна:', error);
        await interaction.reply({ content: 'Что-то пошло не так. Попробуйте еще раз.', ephemeral: true });
    }
};

module.exports = {
    setDepartmentRoleCommand,
    calloutCommand,
    handleModalSubmit
};
