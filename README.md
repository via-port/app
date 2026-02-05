# VIA custom Web App 

This port of VIA enables to self host your own version of the Web App and manual upload of a compatible keyboard JSON without having to compile /keyboards.

## 1. Hosting your own VIA Web App

  TODO: replicate and note all steps to install dependencies and build the app


## 2. Getting your keyboard supported for VIA-PORT

### 1. Create a VIA QMK firmware for your keyboard

Those steps require an existent [QMK](https://qmk.fm/) compatible firmware, if you don't have it already, make one first.

1. Inside your keyboard firmware root folder `qmk-firmware/keyboards/<YOUR_NAME>/<KEYBOARD_NAME>/` create a file `<KEYBOARD_NAME>.json`, in this file add teh following informations about your keyboard:

   ```
   {
     "name": "KEYBOARD_NAME",
     "vendorId": "0x0000",
     "productId": "0x0000",
     "matrix": {
       "rows": 3,
       "cols": 4,
     },
     "layouts": {
      "keymap": {
         ["0,0","0,1","0,2","0,3"],
         ["1,0","1,1","1,2","1,3"],
         ["2,0","2,1","2,2","2,3"]  
       }
     }
   }
   ```
   
  Replace `KEYBOARD_NAME` with the name of your keyboard you want to show on VIA.
  Replace `0x0000` from vendorId and productId with a hex number calculated from a simple [ASCII2HEX converter](https://www.rapidtables.com/convert/number/ascii-to-hex.html), using your name initials for vendorId and 2 keyboard letters for productId. For example "MP" will be converted to 0x4D50 so the vendorId should be `0x4D50`.
  Replace the number of rows and columns of your keyboard.
  Replace the keymap by generating a graphical representation of your keyboard on [KLE](https://www.keyboard-layout-editor.com/) and copying Raw Data generated.
  Add any more information about RGB Lightning, custom functionalities and custom menus by following [VIA DOCS](https://caniusevia.com/docs/specification)

2. Create a folder inside `/keymaps/` called `/via`, you can clone the content from `default`, then create if not present, a file named `rules.mk` and add `VIA_ENABLE = yes` inside this file.
3. Compile your firmware with `qmk compile -kb <YOUR_NAME>/<KEYBOARD_NAME> -km via`
4. flash this firmware in your keyboard

### 2. Make a VIA-PORT version of the json file

1. Open your VIA-PORT Web App from your localhost or from your own hosted address
2. From "setting" menu in the top navigation bar enable `Show Design Tab`
3. Head to `Design` tab and upload the `<YOUR_KEYBOARD>.json` file from your keyboard root folder you created on step 2.

   VIA-PORT should automatically convert your uploaded JSON file in a compatible version and store it in your Web App `/public/definitions/v3/` folder while updating `keyboard_names.json` and `supported_kbs.json` files.
   From now on, your keyboard will be always supported automatically from your localhost/self-hosted VIA Web App.
