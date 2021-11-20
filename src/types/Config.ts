import { Gateway } from "./Gateway";

export interface Config {
  hostname: string;
  port: number;
  gateways: Gateway[]
}
