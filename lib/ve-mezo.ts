import { isAddress, type Address } from 'viem'

export const VEMEZO_ADDRESS: Address = '0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b'
export const VEMEZO_DISTRIBUTOR_ADDRESS: Address = '0x2962E8817ae716019F759d098e2caE658bDcAd04'
export const MEZO_TOKEN_ADDRESS: Address = '0x7B7c000000000000000000000000000000000001'
const configuredFactory = process.env.NEXT_PUBLIC_VEMEZO_YIELD_FACTORY_ADDRESS ?? '0x45374d75ddf7c6c496776c7d33d1eb85a363990d'
export const VEMEZO_YIELD_FACTORY_ADDRESS: Address | undefined =
  configuredFactory && isAddress(configuredFactory) ? configuredFactory : undefined

export const veMezoRewardsDistributorAbi = [
  { type: 'function', name: 'lastTokenTime', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

export const veMezoAbi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'token', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'distributor', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ownerToNFTokenIdList', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getApproved', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'isApprovedForAll', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'operator', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'approved', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'safeTransferFrom', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'locked', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'position', type: 'tuple', components: [{ name: 'amount', type: 'int128' }, { name: 'end', type: 'uint256' }, { name: 'isPermanent', type: 'bool' }] }] },
  { type: 'function', name: 'escrowType', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint8' }] },
] as const

export const erc721ReceiverAbi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'approved', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [] },
] as const
