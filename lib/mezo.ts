import { defineChain, type Address } from 'viem'

export const MEZO_TESTNET_CHAIN_ID = 31_611
export const MUSD_ADDRESS: Address = '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503'
export const SMUSD_VAULT_ADDRESS: Address = '0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16'

export const mezoTestnet = defineChain({
  id: MEZO_TESTNET_CHAIN_ID,
  name: 'Mezo Testnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } },
  testnet: true,
})
