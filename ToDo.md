## TODO

### Very Bad Issues

* [ X ] Fix all current issues

### Structure / Architecture

* [ X ] Move more function calls on static files to the cdn e.g. getting all users/kvs/collections etc
* [ X ] Add update checker and changelog

### Data Model

* [ X ] Allow subscriptions to kv and collections if not already implemented
* [ X ] Store each user in a separate JSON in _auth
    * [ X ] Use user ID as file name for those
* [ X ] Seperate api from raw branch, use master as default raw
* [ _ ] Add folder nesting when approaching the 1k files per directory limit eg. /data/stuff/stuff{1}/stuff{2}/...

### Code Cleanup

* [ X ] Remove `decodeToken` function
* [ X ] Use `encode` for decoding (XOR symmetry)
* [ X ] Remove comment about reversal logic since it makes attacks easier
* [ _ ] No manual internal files list: anything stating with _ is internal and cannot be used for any file-name start

### Security

* [ X ] Add `public` Key-Value by default, containing a list of public tokens
* [ X ] On public token access to the database:

  * [ X ] Check if token exists in `public` list
  * [ X ] If not -> add it
* [ X ] On admin login with token:

  * [ X ] Check against all tokens in `public` list, in decoded mode and not decoded
  * [ X ] If match -> reject login

* [ X ] Add per db auth so no one can just dock to any db from any file

### Maybe

* [ X ] Decrease total file length
* [ X ] Reduce setup complexity and improve overall usability
* [ X ] Refactor the whole thing till im happy with it
* [ X ] set 'master' branch as default for CDN reads ~~or remove all branch functionality~~
* [ X ] Remove legacy normalization of user role when it was no array
* [ X ] Edit and move the subscribe function to work on collections and keys
* [ X ] Branch hav to be passed in ['arrays', 'yuh'] and if yes when fetching looks at the updated time and fetching data from the newest one