interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizes = {
  sm: "h-10 w-10 text-sm",
  md: "h-14 w-14 text-lg",
  lg: "h-20 w-20 text-2xl",
  xl: "h-24 w-24 text-3xl",
};

export default function Avatar({
  name,
  avatarUrl,
  size = "md",
}: UserAvatarProps) {
  const initials = name
    .trim()
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`${sizes[size]} rounded-full border border-slate-200 object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizes[size]} flex items-center justify-center rounded-full bg-blue-600 font-bold text-white`}
    >
      {initials}
    </div>
  );
}