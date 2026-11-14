import { defineChain, isAddress, type Address } from 'viem'

export const MEZO_TESTNET_CHAIN_ID = 31_611
export const MUSD_ADDRESS: Address = '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503'
export const SMUSD_VAULT_ADDRESS: Address = '0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16'
const deployedFactoryAddress: Address = '0x6b547be75203e0c4c54071e9e9c235f36d642a06'
const configuredFactoryAddress = process.env.NEXT_PUBLIC_YIELD_SERIES_FACTORY_ADDRESS
export const YIELD_SERIES_FACTORY_ADDRESS: Address =
  configuredFactoryAddress && isAddress(configuredFactoryAddress) ? configuredFactoryAddress : deployedFactoryAddress

export const mezoTestnet = defineChain({
  id: MEZO_TESTNET_CHAIN_ID,
  name: 'Mezo Testnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } },
  testnet: true,
})
