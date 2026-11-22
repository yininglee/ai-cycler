import { accountReturnPath } from "./account-return-path.ts";

const messages = {
  unavailable: "账号服务暂不可用，请稍后重试。",
  request: "无效的账号请求。",
  length: "请求内容过长。",
  action: "无效的账号操作。",
  email: "请输入有效的邮箱地址。",
  password: "密码至少需要 12 个字符，且不能超过 512 字节。",
  credentials: "邮箱或密码有误。",
  limited: "尝试次数过多，请稍后重试。",
  registered: "此邮箱已注册，请登录。",
} as const;

export type AccountFormError = keyof typeof messages;

export function accountFormErrorMessage(value: unknown): string | undefined {
  return typeof value === "string" && Object.hasOwn(messages, value) ? messages[value as AccountFormError] : undefined;
}

export function accountFormHref(returnTo: unknown, registering: boolean, error?: AccountFormError): string {
  const query = new URLSearchParams();
  const destination = accountReturnPath(returnTo);
  if (destination !== "/chat") query.set("returnTo", destination);
  if (registering) query.set("mode", "register");
  if (error) query.set("error", error);
  return query.size ? `/account?${query}` : "/account";
}
