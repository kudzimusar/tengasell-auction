import { AccountContent } from "../../components/AccountContent";
import { useNxsText } from "../../nxs/localization/useNxsText";

export default function AccountScreen() {
  const t = useNxsText();
  return <AccountContent titleOverride={t("account.title")} />;
}
