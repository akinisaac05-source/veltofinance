import Image from 'next/image'

const logoSrc = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/velto_finance_logo_navy_red%20%281%29-DHtfkYkbidn2OeADVL8AHUUZINRUB7.png'

export function VeltoLogo() {
  return (
    <span className="velto-logo-frame" aria-hidden="true">
      <Image src={logoSrc} alt="" width={1536} height={1024} unoptimized />
    </span>
  )
}
