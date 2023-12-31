import { invoke } from "@tauri-apps/api/tauri";
import { message, save } from "@tauri-apps/api/dialog"
import { WebviewWindow, WindowOptions } from "@tauri-apps/api/window";
import { emit, once } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/api/clipboard";
import { translations, getTranslation } from "./translations";

const macSpacing = "      ";

const $b = (selector: string): HTMLButtonElement => document.querySelector(selector)!;

let webviewPing: WebviewWindow | undefined = undefined;
var gateway: string | null = null;

const execute = async (command: string): Promise<any> => {
    try {
        return await invoke(command)
    } catch (error) {
        return "<b>Error</b>: " + error;
    }
}

/// [net, hardware]
const tablesToMaps = (): [Array<[string, string]>, Array<[string, string]>] => {
    // extract the information
    let tableHardware: HTMLTableElement | null = document.querySelector("#hardware-table")!;
    let tableNet: HTMLTableElement | null = document.querySelector("#network-table")!;

    var hardwareMap: Array<[string, string]> = [];
    var netMap: Array<[string, string]> = [];

    for (let i = 1; i < tableHardware.rows.length; i++) {
        hardwareMap.push(
            [tableHardware.rows[i].cells[0].textContent!.padEnd(30), tableHardware.rows[i].cells[1].textContent!]
        )
    }
    for (let i = 1; i < tableNet.rows.length; i++) {
        netMap.push(
            [tableNet.rows[i].cells[0].textContent!.padEnd(30), tableNet.rows[i].cells[1].textContent!]
        )
    }

    return [netMap, hardwareMap];
}

enum hardwareOrder {
    OS = 1, USR, CPU_MOD, CPU_CORES, RAM, DISK
}
enum networkOrder {
    INT_IP4 = 1, SUBNET, GATEWAY, INT_IP6, EXT_IP4, EXT_IP6,
}

const tbAt = (tbl: HTMLTableElement | null, i: number) => tbl!.rows[i].cells[1]

async function fetchInformation() {
    let tableHardware: HTMLTableElement | null = document.querySelector("#hardware-table");
    let tableNet: HTMLTableElement | null = document.querySelector("#network-table");

    if (tableHardware && tableNet) {
        let allTables = document.querySelectorAll("table")!;
        for (let i = 0; i < allTables.length; i++) {
            for (let j = 1; j < allTables[i].rows.length; j++) {
                allTables[i].rows[j].cells[1].innerHTML = '<i style="color:gray">loading...</i>'
            }
        }

        /* hardware table */

        execute("os_version").then((response: string) => tbAt(tableHardware, hardwareOrder.OS).innerHTML = response);
        execute("username").then((response: string) => tbAt(tableHardware, hardwareOrder.USR).innerHTML = response);
        execute("cpu_model").then((response: string) => tbAt(tableHardware, hardwareOrder.CPU_MOD).innerHTML = response);
        execute("cpu_stats").then((response: [number, number]) => tbAt(tableHardware, hardwareOrder.CPU_CORES).innerHTML = response[0] + ' cores @ ' + (response[1] === 0 ? "?" : response[1]) + ' MHz')
        execute("ram").then((response: Record<string, number>) => tbAt(tableHardware, hardwareOrder.RAM).innerHTML =
            `${Math.floor(response["total"] / 1024)} Mb (${(Math.floor(response["total"] / 1024) / 1000).toFixed(1)} Gb)`);

        execute("disk").then((response: Array<number>) => {
            const total_gb = response[0] / 1024 / 1024;
            const used_gb = response[1] / 1024 / 1024;
            const used_prc = (response[1] / response[0]) * 100

            tbAt(tableHardware, hardwareOrder.DISK).innerHTML =
                `${total_gb.toFixed(1)} Gb (used: ${used_gb.toFixed(1)} Gb = ${used_prc.toFixed(2)}%)`
        });

        /* network table */

        execute("gateway_and_mac").then((response: Record<string, string>) => {
            tbAt(tableNet, networkOrder.GATEWAY).innerHTML = response[0];
            tbAt(tableNet, networkOrder.INT_IP4).innerHTML += `${macSpacing}(MAC: ${response[1]})`;

            if (webviewPing === undefined) {
                gateway = response[0];
            } else {
                emit("gateway-loaded", response[0]);
            }
        });

        execute("local_ipv4_and_mask").then((response: [string, string]) => {
            const intIp4 = tbAt(tableNet, networkOrder.INT_IP4);

            if (intIp4.innerHTML!.length > "loading...".length) {
                const macSection = intIp4.innerHTML!.split(macSpacing)[1];
                intIp4.innerHTML = response[0] + macSpacing + macSection;
            } else intIp4.innerHTML = response[0];

            tbAt(tableNet, networkOrder.SUBNET).innerHTML = response[1];
        });
        execute("local_ipv6").then((response: string) => tbAt(tableNet, networkOrder.INT_IP6).innerHTML = response);

        execute("external_ipv4").then((response: string) => tbAt(tableNet, networkOrder.EXT_IP4).innerHTML = response);
        execute("external_ipv6").then((response: string) => tbAt(tableNet, networkOrder.EXT_IP6).innerHTML = response);
    }
}

window.addEventListener("DOMContentLoaded", async () => {
    const os: string = await invoke("os_type");

    const btnConf = $b("#btn-conf");
    // btnPrinters
    const btnTools = $b("#btn-wintools");
    const btnPrograms = $b("#btn-programs");
    const btnCmd = $b("#btn-cmd");
    // btnPing
    const btnSave = $b("#btn-save");
    const btnCopy = $b("#btn-copy");

    // translations
    const trans = getTranslation;

    btnSave.innerHTML = trans(translations.save_to_file);
    btnCopy.innerHTML = trans(translations.copy);

    switch (os) {
        case "windows":
            btnCmd.innerHTML = "cmd";
            btnConf.innerHTML = trans(translations.config_panel);
            btnTools.innerHTML = trans(translations.windows_tools);
            btnPrograms.innerHTML = trans(translations.installed_apps);
            break;
        case "macos":
            btnCmd.innerHTML = "terminal";
            btnConf.innerHTML = getTranslation(translations.system_prefs);
            btnTools.innerHTML = getTranslation(translations.about_my_mac);
            btnPrograms.innerHTML = getTranslation(translations.installed_apps);
            break;
        default:
            throw new SyntaxError("unsupported platform: " + os);
        // TODO
    }

    fetchInformation();

    document.onkeydown = (e: KeyboardEvent) => {
        if (e.key === "F5") fetchInformation();
    }

    document.querySelector("#btn-save")!.addEventListener("click", async () => {
        var path = await save({
            filters: [{
                name: "Text file",
                extensions: ['txt', '*']
            }],
            title: "save system information to file",
            defaultPath: "toolfetch-info.txt"
        });

        if (!path) return;

        let [netMap, hardwareMap] = tablesToMaps();

        // write the file
        await invoke(
            "button_save", { path: path, hardwareInfo: hardwareMap, networkInfo: netMap }
        ).catch((err) => message(`${path}: ${err}`, { title: "Error while writing file!" }));
    });

    const addListener = (selector: string, name: string, args: Array<string> = [], noWindow: boolean = true) => {
        document.querySelector(selector)!.addEventListener("click", async () => {
            await invoke("button_open", {
                name: name,
                args: args,
                noWindow: noWindow
            }).catch((err) => message(`failed to start ${name}: ${err}`, { title: "Error" }))
        });
    }

    type Args = [string, string[]?];

    const ArgsDefault: Args = ["",];

    let btnConfArgs: Args = ArgsDefault;
    let btnPrintersArgs: Args = ArgsDefault;
    let btnToolsArgs: Args = ArgsDefault; // about my mac on Macos
    let btnProgramsArgs: Args = ArgsDefault;
    let btnCmdArgs: Args = ArgsDefault;

    switch (os) {
        case "windows":
            btnConfArgs = ["control"];
            btnPrintersArgs = ["control", ["printers"]];
            btnToolsArgs = ["control", ["admintools"]];
            btnProgramsArgs = ["control", ["appwiz.cpl"]];
            btnCmdArgs = ["cmd.exe", ["/c", "start"]];
            break;
        case "macos":
            btnConfArgs = ["open", ["-b", "com.apple.systempreferences"]];
            btnPrintersArgs = ["open", ["-b", "com.apple.systempreferences", "/System/Library/PreferencePanes/PrintAndScan.prefPane"]];
            btnToolsArgs = ["open", ["-a", "About This Mac"]];
            btnProgramsArgs = ["open", ["-a", "Finder", "/Applications/"]];
            btnCmdArgs = ["open", ["-a", "Terminal"]];
            break;
        default:
            break;
    }

    addListener("#btn-conf", ...btnConfArgs)
    addListener("#btn-printers", ...btnPrintersArgs);
    addListener("#btn-wintools", ...btnToolsArgs);
    addListener("#btn-programs", ...btnProgramsArgs);
    addListener("#btn-cmd", ...btnCmdArgs);


    document.querySelector("#btn-copy")!.addEventListener("click", async () => {
        let [netMap, hardwareMap] = tablesToMaps();
        await writeText(await invoke("button_copy", { hardwareInfo: hardwareMap, networkInfo: netMap }));
    });

    document.querySelector("#btn-ping")!.addEventListener("click", async () => {
        const dimensions = {
            "windows": {
                "width": 400,
                "height": 130,
            },
            "macos": {
                "width": 415,
                "height": 170
            }
        };

        let height: number = dimensions[os].width || dimensions["windows"].width;
        let width: number = dimensions[os].height || dimensions["windows"].height;

        const webviewOptions: WindowOptions = {
            center: true,
            focus: true,
            title: "Ping Options",
            visible: true,
            height: height,
            width: width,
            fileDropEnabled: false,
            resizable: false,
            url: "/pingoptions.html",
            alwaysOnTop: true,
        };
        webviewPing = new WebviewWindow("Ping-options", webviewOptions);

        once("ping-window-loaded", async () => {
            if (gateway) emit("gateway-loaded", gateway)
        });

        webviewPing.once("tauri://error", (error) => {
            message(`failed to open window: ${error.payload}`, { title: "Window error" });
        });
    });
});