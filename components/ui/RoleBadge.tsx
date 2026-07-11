import Badge from "./Badge";

interface RoleBadgeProps {
  role: string;
}

export default function RoleBadge({
  role,
}: RoleBadgeProps) {
  switch (role) {
    case "Admin":
      return (
        <Badge color="blue">
          {role}
        </Badge>
      );

    case "Dentist":
      return (
        <Badge color="green">
          {role}
        </Badge>
      );

    case "Receptionist":
      return (
        <Badge color="yellow">
          {role}
        </Badge>
      );

    default:
      return (
        <Badge color="gray">
          {role}
        </Badge>
      );
  }
}