import { Blockchain, SandboxContract, TreasuryContract, printTransactionFees } from '@ton-community/sandbox';
import { Address, Cell, beginCell, toNano } from 'ton-core';
import { MassSender, Msg } from '../wrappers/MassSender';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { randomAddress } from '@ton-community/test-utils';
import { randomInt } from 'crypto';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';

describe('MassSender', () => {
    let code: Cell;
    let randomAddresses: Address[] = [];
    let codeJettonMinter: Cell;
    let codeJettonWallet: Cell;

    beforeAll(async () => {
        code = await compile('MassSender');
        codeJettonMinter = await compile('JettonMinter');
        codeJettonWallet = await compile('JettonWallet');
        for (let i = 0; i < 1400; i++) {
            randomAddresses.push(randomAddress());
        }
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let jettonMinter: SandboxContract<JettonMinter>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');

        jettonMinter = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: deployer.address,
                    content: Cell.EMPTY,
                    walletCode: codeJettonWallet,
                },
                codeJettonMinter
            )
        );

        let deployResult = await jettonMinter.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            deploy: true,
        });
    });

    it('should deploy', async () => {});

    it('should send one message', async () => {
        let massSender = blockchain.openContract(
            MassSender.createFromConfig(
                {
                    messages: [{ value: toNano('1'), destination: randomAddresses[0] }],
                    admin: deployer.address,
                },
                code
            )
        );
        let res = await jettonMinter.sendMint(
            deployer.getSender(),
            toNano('0.1'),
            toNano('0.05'),
            massSender.address,
            toNano('1')
        );
        const jetton_wallet_address = await jettonMinter.getWalletAddressOf(massSender.address);
        const result = await massSender.sendDeploy(deployer.getSender(), jetton_wallet_address);
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: massSender.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: massSender.address,
            to: jetton_wallet_address,
        });
        const jetton_wallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddressOf(randomAddresses[0]))
        );
        expect(await jetton_wallet.getJettonBalance()).toEqual(toNano('1'));
        expect((await blockchain.getContract(massSender.address)).balance).toEqual(0n);
        expect(await massSender.getHasFinished()).toBeTruthy();
    });

    it('should send one message to admin', async () => {
        let massSender = blockchain.openContract(
            MassSender.createFromConfig(
                {
                    messages: [{ value: toNano('0.1'), destination: deployer.address }],
                    admin: deployer.address,
                },
                code
            )
        );
        let res = await jettonMinter.sendMint(
            deployer.getSender(),
            toNano('0.1'),
            toNano('0.05'),
            massSender.address,
            toNano('0.1')
        );
        const jetton_wallet_address = await jettonMinter.getWalletAddressOf(massSender.address);
        const result = await massSender.sendDeploy(deployer.getSender(), jetton_wallet_address);
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: massSender.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: massSender.address,
            to: jetton_wallet_address,
        });
        const jetton_wallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddressOf(deployer.address))
        );
        expect(await jetton_wallet.getJettonBalance()).toEqual(toNano('0.1'));
        expect((await blockchain.getContract(massSender.address)).balance).toEqual(0n);
        expect(await massSender.getHasFinished()).toBeTruthy();
    });

    it('should send 254 messages', async () => {
        let massSender = blockchain.openContract(
            MassSender.createFromConfig(
                {
                    messages: randomAddresses.slice(0, 254).map((addr, idx) => ({
                        value: toNano(idx + 1),
                        destination: addr,
                    })),
                    admin: deployer.address,
                },
                code
            )
        );
        let res = await jettonMinter.sendMint(
            deployer.getSender(),
            toNano('0.1'),
            toNano('0.05'),
            massSender.address,
            toNano('100000000000')
        );
        const jetton_wallet_address = await jettonMinter.getWalletAddressOf(massSender.address);
        const result = await massSender.sendDeploy(deployer.getSender(), jetton_wallet_address);
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: massSender.address,
            success: true,
        });
        for (let i = 0; i < 254; ++i) {
            expect(result.transactions).toHaveTransaction({
                from: massSender.address,
                to: jetton_wallet_address,
            });
            const jetton_wallet = blockchain.openContract(
                JettonWallet.createFromAddress(await jettonMinter.getWalletAddressOf(randomAddresses[i]))
            );
            expect(await jetton_wallet.getJettonBalance()).toEqual(toNano(i + 1));
        }
        expect((await blockchain.getContract(massSender.address)).balance).toEqual(0n);
        expect(await massSender.getHasFinished()).toBeTruthy();
    });

    it('should send 1400 messages', async () => {
        let massSender = blockchain.openContract(
            MassSender.createFromConfig(
                {
                    messages: randomAddresses.map((addr, idx) => ({
                        value: toNano(idx + 1),
                        destination: addr,
                    })),
                    admin: deployer.address,
                },
                code
            )
        );
        let res = await jettonMinter.sendMint(
            deployer.getSender(),
            toNano('0.1'),
            toNano('0.05'),
            massSender.address,
            toNano('100000000000')
        );
        const jetton_wallet_address = await jettonMinter.getWalletAddressOf(massSender.address);
        const result = await massSender.sendDeploy(deployer.getSender(), jetton_wallet_address);
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: massSender.address,
            success: true,
        });
        for (let i = 0; i < 1400; ++i) {
            expect(result.transactions).toHaveTransaction({
                from: massSender.address,
                to: jetton_wallet_address,
            });
            const jetton_wallet = blockchain.openContract(
                JettonWallet.createFromAddress(await jettonMinter.getWalletAddressOf(randomAddresses[i]))
            );
            expect(await jetton_wallet.getJettonBalance()).toEqual(toNano(i + 1));
        }
        expect((await blockchain.getContract(massSender.address)).balance).toEqual(0n);
        expect(await massSender.getHasFinished()).toBeTruthy();
    });

    it('should send 600 messages', async () => {
        let massSender = blockchain.openContract(
            MassSender.createFromConfig(
                {
                    messages: randomAddresses.slice(0, 600).map((addr, idx) => ({
                        value: toNano(idx + 1),
                        destination: addr,
                    })),
                    admin: deployer.address,
                },
                code
            )
        );
        let res = await jettonMinter.sendMint(
            deployer.getSender(),
            toNano('0.1'),
            toNano('0.05'),
            massSender.address,
            toNano('100000000000000')
        );
        const jetton_wallet_address = await jettonMinter.getWalletAddressOf(massSender.address);
        const result = await massSender.sendDeploy(deployer.getSender(), jetton_wallet_address);
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: massSender.address,
            success: true,
        });
        for (let i = 0; i < 600; ++i) {
            expect(result.transactions).toHaveTransaction({
                from: massSender.address,
                to: jetton_wallet_address,
            });
            const jetton_wallet = blockchain.openContract(
                JettonWallet.createFromAddress(await jettonMinter.getWalletAddressOf(randomAddresses[i]))
            );
            expect(await jetton_wallet.getJettonBalance()).toEqual(toNano(i + 1));
        }
        expect((await blockchain.getContract(massSender.address)).balance).toEqual(0n);
        expect(await massSender.getHasFinished()).toBeTruthy();
    });

    it('should send message several times', async () => {
        async function sendMessage(msg: Msg) {
            let massSender = blockchain.openContract(
                MassSender.createFromConfig(
                    {
                        messages: [msg],
                        admin: deployer.address,
                    },
                    code
                )
            );
            let res = await jettonMinter.sendMint(
                deployer.getSender(),
                toNano('0.1'),
                toNano('0.05'),
                massSender.address,
                msg.value
            );
            const jetton_wallet_address = await jettonMinter.getWalletAddressOf(massSender.address);
            const result = await massSender.sendDeploy(deployer.getSender(), jetton_wallet_address);
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: massSender.address,
                success: true,
            });
            expect(result.transactions).toHaveTransaction({
                from: massSender.address,
                to: jetton_wallet_address,
            });
            const jetton_wallet = blockchain.openContract(
                JettonWallet.createFromAddress(await jettonMinter.getWalletAddressOf(msg.destination))
            );
            expect(await jetton_wallet.getJettonBalance()).toEqual(msg.value);
            expect((await blockchain.getContract(massSender.address)).balance).toEqual(0n);
            expect(await massSender.getHasFinished()).toBeTruthy();
        }

        for (let i = 0; i < 15; ++i) {
            await sendMessage({
                value: toNano(randomInt(1, 100)),
                destination: randomAddresses[i],
            });
        }
    });

    it('should send one message with comment', async () => {
        let massSender = blockchain.openContract(
            MassSender.createFromConfig(
                {
                    messages: [
                        { value: toNano('1'), destination: randomAddresses[0], comment: "It's a test comment, lol" },
                    ],
                    admin: deployer.address,
                },
                code
            )
        );
        let res = await jettonMinter.sendMint(
            deployer.getSender(),
            toNano('0.1'),
            toNano('0.05'),
            massSender.address,
            toNano('1')
        );
        const jetton_wallet_address = await jettonMinter.getWalletAddressOf(massSender.address);
        const result = await massSender.sendDeploy(deployer.getSender(), jetton_wallet_address);
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: massSender.address,
            success: true,
        });
        const jetton_wallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddressOf(randomAddresses[0]))
        );
        expect(await jetton_wallet.getJettonBalance()).toEqual(toNano('1'));
        expect(result.transactions).toHaveTransaction({
            from: jetton_wallet.address,
            to: randomAddresses[0],
            // transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
            //                   sender:MsgAddress forward_payload:(Either Cell ^Cell)
            //                   = InternalMsgBody;
            body: beginCell()
                .storeUint(0x7362d09c, 32)
                .storeUint(0, 64)
                .storeCoins(toNano('1'))
                .storeAddress(massSender.address)
                .storeMaybeRef(beginCell().storeUint(0, 32).storeStringRefTail("It's a test comment, lol").endCell())
                .endCell(),
        });
        expect((await blockchain.getContract(massSender.address)).balance).toEqual(0n);
        expect(await massSender.getHasFinished()).toBeTruthy();
    });
});
