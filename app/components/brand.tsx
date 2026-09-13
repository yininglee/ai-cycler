import Link from "next/link";

import { BikeIcon } from "./icons";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="返回首页">
      <span className="brand-mark"><BikeIcon /></span>
      <span>骑行伙伴</span>
    </Link>
  );
}
