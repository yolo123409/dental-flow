import Badge from "./Badge";

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({
  status,
}: StatusBadgeProps) {
  switch (status) {
    case "Active":
      return (
        <Badge color="green">
          {status}
        </Badge>
      );

    case "Suspended":
      return (
        <Badge color="red">
          {status}
        </Badge>
      );

    case "Pending":
      return (
        <Badge color="yellow">
          {status}
        </Badge>
      );

    default:
      return (
        <Badge color="gray">
          {status}
        </Badge>
      );
  }
}