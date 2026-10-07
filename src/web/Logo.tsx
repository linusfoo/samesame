/** The SameSame mark: two identical price tags stacked into an equals sign. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="4 6 24 20" aria-hidden="true">
      <path d="M5 11 8.5 7.5H26.5V14.5H8.5Z" fill="currentColor" />
      <path d="M5 21 8.5 17.5H26.5V24.5H8.5Z" fill="currentColor" />
      <circle cx="10" cy="11" r="1.4" fill="var(--mark-bg)" />
      <circle cx="10" cy="21" r="1.4" fill="var(--mark-bg)" />
    </svg>
  );
}
