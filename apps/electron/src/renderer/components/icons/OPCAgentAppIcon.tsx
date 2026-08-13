import opcagentIcon from "@/assets/opcagent_app_icon.svg"

interface OPCAgentAppIconProps {
  className?: string
  size?: number
}

/**
 * OPCAgentAppIcon - Displays the OPC Agent app icon.
 */
export function OPCAgentAppIcon({ className, size = 64 }: OPCAgentAppIconProps) {
  return (
    <img
      src={opcagentIcon}
      alt="OPC Agent"
      width={size}
      height={size}
      className={className}
    />
  )
}
