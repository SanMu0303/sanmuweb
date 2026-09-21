import type {Metadata} from "next";
import TerminalWorkspace from "@/components/TerminalWorkspace";

export const metadata:Metadata = {title:"交易终端", description:"行情、消息与聪明钱线索的可调整研究桌面。"};

export default function TerminalPage() {
  return <TerminalWorkspace/>;
}
