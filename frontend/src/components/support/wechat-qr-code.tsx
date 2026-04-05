import { QRCodeSVG } from 'qrcode.react'

const WECHAT_QR_URL = import.meta.env.VITE_WECHAT_QR_URL || 'https://u.wechat.com/MF5PYmxZDLIHeXt8bY78UYg?s=2'

interface WechatQrCodeProps {
  size?: number
}

export function WechatQrCode({ size = 104 }: WechatQrCodeProps) {
  return (
    <div className="inline-flex shrink-0 border border-border bg-card p-2">
      <QRCodeSVG
        value={WECHAT_QR_URL}
        size={size}
        level="H"
        includeMargin={false}
        fgColor="currentColor"
        bgColor="transparent"
      />
    </div>
  )
}
