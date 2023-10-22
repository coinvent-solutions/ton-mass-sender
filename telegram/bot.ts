require('dotenv').config();

import TelegramBot from 'node-telegram-bot-api';
import * as fs from 'fs';
import * as os from 'os';
import { Msg, massSenderConfigToCell } from '../wrappers/MassSender';
import { TonConnectProvider } from './provider';
import { Address, Cell, contractAddress, fromNano, toNano } from 'ton-core';
import { compile } from '@ton-community/blueprint';
import { initRedisClient } from './tonconnect/storage';
import { toFile } from 'qrcode';
import { getConnector } from './tonconnect/connector';
import { parse } from 'csv-parse/sync';
import path from 'path';

const TOO_BIG_FILE = 1024 * 1024; // 1 megabyte

const token = process.env.TELEGRAM_BOT_TOKEN!;
const bot = new TelegramBot(token, { polling: true });
let code: Cell;

class JsonError extends Error {
    constructor() {
        super('');
        Object.setPrototypeOf(this, JsonError.prototype);
    }
}
class CsvError extends Error {
    constructor(public duplicate: string) {
        super('');
        Object.setPrototypeOf(this, CsvError.prototype);
    }
}

async function sendTransaction(messages: Msg[], chatId: number, provider: TonConnectProvider) {
    const data = massSenderConfigToCell({
        messages: messages,
        admin: provider.address()!,
    });

    const address = contractAddress(0, {
        code,
        data,
    });
    const value =
        messages.map((msg) => msg.value).reduce((a, b) => a + b) +
        BigInt(messages.length + Math.ceil(messages.length / 254)) * toNano('0.1');

    await bot.sendMessage(chatId, 'Please confirm the transaction in your Tonkeeper wallet.');

    try {
        await provider.sendTransaction(address, value, undefined, {
            code,
            data,
        });
        await bot.sendMessage(chatId, 'Success! The transaction has been sent.');
        await bot.sendMessage(
            chatId,
            'You can explore the details of your transactions by using the following links:\n[Tonscan](https://tonscan.org/address/' +
                address +
                ')\n[Tonviewer](https://tonviewer.com/' +
                address +
                ')\n[Ton Whales](https://tonwhales.com/explorer/address/' +
                address +
                ')',
            {
                parse_mode: 'MarkdownV2',
                disable_web_page_preview: true,
            }
        );
    } catch (UserRejectsError) {
        console.log(UserRejectsError);
        await bot.sendMessage(chatId, 'The transaction was rejected. If this was a mistake, please try again.');
    }
}

async function processMessages(messages: Msg[], chatId: number) {
    if (messages.length > 1300) {
        await bot.sendMessage(
            chatId,
            "You've exceeded the maximum transaction limit. Please limit your transactions to 1300 or less."
        );
        return;
    }

    const provider = new TonConnectProvider(getConnector(chatId), 'Tonkeeper');
    await provider.restoreConnection();

    if (!provider.address()) {
        await bot.sendMessage(chatId, 'Please connect your Tonkeeper wallet to proceed.');

        const url = await provider.getConnectUrl();

        if (url === undefined) {
            await bot.sendMessage(chatId, 'Oops! An unknown error occurred. Please try again later.');
            return;
        }

        const filename: string = path.join(os.tmpdir(), 'qrcode' + Math.floor(Math.random() * 1e6) + '.png');
        toFile(filename, url, async () => {
            const msg = await bot.sendPhoto(chatId, filename, {
                caption: 'Please scan this QR code using your Tonkeeper wallet.',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: 'Open Tonkeeper',
                                url,
                            },
                        ],
                    ],
                },
            });
            await fs.promises.rm(filename);
            await provider.connect(async () => {
                await bot.deleteMessage(chatId, msg.message_id);
                await bot.sendMessage(chatId, 'Success! Your Tonkeeper wallet is now connected.');
                await sendTransaction(messages, chatId, provider);
            });
        });
    } else {
        await sendTransaction(messages, chatId, provider);
    }
}

async function main(): Promise<void> {
    await initRedisClient();

    code = await compile('MassSender');
    Object.freeze(code);

    bot.on('document', async (msg) => {
        try {
            await (async (msg) => {
                const chatId = msg.chat.id;
                if (msg.document!.file_size! > TOO_BIG_FILE) {
                    await bot.sendMessage(
                        chatId,
                        'The file you uploaded is too large. Please ensure your file is less than 1MB.'
                    );
                    return;
                }

                let rawMessages: {
                    [key: string]: {
                        value: bigint;
                        comment: string;
                    };
                };

                if (msg.document!.file_name!.endsWith('.json')) {
                    try {
                        rawMessages = await (await fetch(await bot.getFileLink(msg.document!.file_id))).json();
                        Object.keys(rawMessages).forEach((key) => {
                            if (typeof rawMessages[key]['value'] != 'string') {
                                throw new JsonError();
                            }
                            rawMessages[key]['value'] = toNano(rawMessages[key]['value']);
                        });
                    } catch (e) {
                        console.log(e, e instanceof JsonError);
                        if (e instanceof JsonError) {
                            await bot.sendMessage(
                                chatId,
                                'The values must be provided as strings\\. Example:\n`{\n  "EQBIhPuWmjT7fP-VomuTWseE8JNWv2q7QYfsVQ1IZwnMk8wL": { "vaue": "0.1", "comment" : ""},\n  "EQBKgXCNLPexWhs2L79kiARR1phGH1LwXxRbNsCFF9doc2lN": { "value": "1.2", "comment": "Tsc4 reward"}\n}`',
                                { parse_mode: 'MarkdownV2' }
                            );
                        } else {
                            await bot.sendMessage(
                                chatId,
                                'The uploaded JSON file is invalid. Please check the file and try again.'
                            );
                        }
                        return;
                    }
                } else if (msg.document!.file_name!.endsWith('.csv')) {
                    try {
                        rawMessages = parse(await (await fetch(await bot.getFileLink(msg.document!.file_id))).text(), {
                            skip_empty_lines: true,
                        }).reduce((map: { [key: string]: { value: bigint; comment: string } }, obj: string[3]) => {
                            if (map[obj[0]] !== undefined) {
                                throw new CsvError(obj[0]);
                            }
                            map[obj[0]]['value'] = toNano(obj[1]);
                            map[obj[0]]['comment'] = obj[2];
                            return map;
                        }, {});
                    } catch (e) {
                        if (e instanceof CsvError) {
                            await bot.sendMessage(
                                chatId,
                                'To avoid confusion, please ensure there are no duplicate addresses to send Toncoin to\\. The address `' +
                                    e.duplicate! +
                                    '` appears multiple times\\.',
                                { parse_mode: 'MarkdownV2' }
                            );
                        } else {
                            await bot.sendMessage(
                                chatId,
                                'The uploaded CSV file is invalid. Please check the file and try again.'
                            );
                        }
                        return;
                    }
                } else {
                    await bot.sendMessage(
                        chatId,
                        "The file type you uploaded isn't supported. Please ensure your file extension is either `.json` or `.csv`."
                    );
                    return;
                }

                let messages: Msg[] = [];
                const addresses = Object.keys(rawMessages);
                for (let i = 0; i < addresses.length; i++) {
                    const addr = addresses[i];
                    if (rawMessages[addr]['value'] <= 0n) {
                        await bot.sendMessage(
                            chatId,
                            'The value at position ' + (i + 1) + ' is invalid: ' + fromNano(rawMessages[addr]['value'])
                        );
                        return;
                    }
                    let destination: Address;
                    try {
                        destination = Address.parse(addr);
                    } catch {
                        await bot.sendMessage(
                            chatId,
                            'The address at position ' + (i + 1) + ' is invalid:\n"' + addr + '"'
                        );
                        return;
                    }
                    messages.push({
                        value: rawMessages[addr]['value'],
                        destination: destination,
                        comment: rawMessages[addr]['comment'],
                    });
                }
                await processMessages(messages, chatId);
            })(msg);
        } catch (e) {
            console.log(e);
        }
    });

    bot.onText(/.*/, async (msg) => {
        try {
            await (async (msg) => {
                if (!msg.text?.match(/^([a-zA-Z0-9-_]+: -?\d+(\.\d+)?\n*)+$/g)) {
                    await bot.sendMessage(
                        msg.chat.id,
                        `*👋 Hello and welcome to the TON Mass Sender bot\\!*\nI'm here to help you send Toncoin to multiple addresses at once\\. You can provide me with a list of addresses in one of the following formats:\n\n*🔹 Plain text*\\: You can send the address, value and comment separated by a comma and a space \\(empty place for no comment\\), with each address on a new line\\. Example:\n\`EQBIhPuWmjT7fP-VomuTWseE8JNWv2q7QYfsVQ1IZwnMk8wL, 0.1, \nEQBKgXCNLPexWhs2L79kiARR1phGH1LwXxRbNsCFF9doc2lN, 1.2, Tsc4 reward\`\n\n*🔹 JSON format*\\: Send a JSON object where each key is an address and the corresponding object has two fields: "value" is the amount to be sent and "comment" with comment to transactions \\("" for no comment\\)\\.\n\n*🔹 CSV format*\\: Send a CSV file where each row contains an address, the corresponding value and comment \\(empty place for no comment\\) separated by a comma\\.\n\nLet's get started\\!`,
                        { parse_mode: 'MarkdownV2' }
                    );
                    return;
                }

                const chatId = msg.chat.id;

                const rawMessagesText = msg.text!.split('\n');
                const rawMessages = rawMessagesText.filter((t) => t != '').map((t) => t.split(', '));

                let messages: Msg[] = [];
                let addressSet = new Set();
                for (let i = 0; i < rawMessages.length; i++) {
                    const msg = rawMessages[i];
                    if (msg.length < 3) {
                        await bot.sendMessage(
                            chatId,
                            'The comment at position ' +
                                (i + 1) +
                                ' is apsent. To leave a empty comment type comma in the end of stroke.'
                        );
                        return;
                    }
                    const value = toNano(msg[1]);
                    if (value <= 0) {
                        await bot.sendMessage(chatId, 'The value at position ' + (i + 1) + ' is invalid: ' + msg[1]);
                        return;
                    }
                    let destination: Address;
                    try {
                        destination = Address.parse(msg[0]);
                        if (addressSet.has(msg[0])) {
                            await bot.sendMessage(
                                chatId,
                                'To avoid confusion, please ensure there are no duplicate addresses to send Toncoin to\\. The address `' +
                                    msg[0] +
                                    '` appears multiple times\\.',
                                { parse_mode: 'MarkdownV2' }
                            );
                            return;
                        }
                        addressSet.add(msg[0]);
                    } catch {
                        await bot.sendMessage(
                            chatId,
                            'The address at position ' + (i + 1) + ' is invalid:\n"' + msg[0] + '"'
                        );
                        return;
                    }
                    let comment = msg[2];
                    messages.push({
                        value,
                        destination,
                        comment,
                    });
                }

                await processMessages(messages, chatId);
            })(msg);
        } catch (e) {
            console.log(e);
        }
    });
}

main();
