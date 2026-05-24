interface SpinnerProps {
  size?: number;
}

export function Spinner({ size = 18 }: SpinnerProps) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      aria-label="Loading"
      role="status"
    />
  );
}
