import React from "react";
import { ProviderOrders } from "@/features/c/ProviderOrders";
import { ProviderServiceOrders } from "@/features/c/ProviderServiceOrders";

export default function Page() {
  return <div className="space-y-10"><ProviderServiceOrders /><ProviderOrders /></div>;
}
