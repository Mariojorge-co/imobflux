import type { ComponentPropsWithRef } from "react";
import Image, { type ImageProps } from "next/image";
import { classNames } from "@/lib/class-names";

const avatarSizes = {
  sm: {
    className: "size-8 text-caption",
    imageSizes: "32px",
  },
  md: {
    className: "size-10 text-body",
    imageSizes: "40px",
  },
  lg: {
    className: "size-12 text-base",
    imageSizes: "48px",
  },
} as const;

export type AvatarSize = keyof typeof avatarSizes;

export type AvatarProps = Omit<
  ComponentPropsWithRef<"span">,
  "children"
> & {
  alt?: string;
  name: string;
  size?: AvatarSize;
  /** URLs remotas precisam estar autorizadas na configuração de imagens do Next.js. */
  src?: ImageProps["src"];
};

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

export function Avatar({
  alt,
  className,
  name,
  size = "md",
  src,
  ...props
}: AvatarProps) {
  const selectedSize = avatarSizes[size];

  return (
    <span
      className={classNames(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill border border-border bg-neutral-soft font-semibold text-neutral",
        selectedSize.className,
        className,
      )}
      {...props}
    >
      {src ? (
        <Image
          alt={alt ?? name}
          className="object-cover"
          fill
          sizes={selectedSize.imageSizes}
          src={src}
          unoptimized={typeof src === "string" && src.startsWith("/api/")}
        />
      ) : (
        <span aria-label={alt ?? name} role="img">
          {getInitials(name)}
        </span>
      )}
    </span>
  );
}
