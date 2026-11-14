export const SITE_CONFIG={
  "defaultDataset": "demo",
  "notice": "Демонстрация на вымышленных данных. Свои CSV и логи открываются только в вашем браузере и не отправляются на сервер.",
  "datasets": {
    "demo": {
      "prefix": "demo-",
      "rosterFile": "./data/demo-roster.csv",
      "label": "Пример разморозки · вымышленные данные"
    },
    "demo-roster": {
      "roster": true,
      "file": "./data/demo-roster.csv",
      "label": "Пример составов · вымышленные данные"
    }
  }
};
