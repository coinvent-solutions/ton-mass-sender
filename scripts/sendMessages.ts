import { Address, toNano } from 'ton-core';
import { MassSender, Msg } from '../wrappers/MassSender';
import { compile, NetworkProvider } from '@ton-community/blueprint';

export async function process(provider: NetworkProvider, messages: Msg[]) {
    const massSender = provider.open(
        MassSender.createFromConfig(
            {
                messages,
                admin: provider.sender().address!,
            },
            await compile('MassSender')
        )
    );

    await massSender.sendDeploy(
        provider.sender(),
        messages.map((msg) => msg.value).reduce((a, b) => a + b)
    );

    await provider.waitForDeploy(massSender.address);
}

export async function run(provider: NetworkProvider) {
    let rawMessages = require('./transactions.json');
    let messages: Msg[] = [];
    for (const addr of Object.keys(rawMessages)) {
        messages.push({
            value: toNano(rawMessages[addr]["value"]),
            destination: Address.parse(addr),
            comment: rawMessages[addr]["comment"],
        });
    }
    await process(provider, messages);
}
