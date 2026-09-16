// Only the server's verified session and current database membership may grant access.
export const emptyMembership=()=>({status:'none',expiresAt:null,revision:0});
export function canReadMemberContent(user,now=Date.now()){
 return !!user?.isAdmin||!!(user?.signedIn&&user.isMember&&user.membership?.status==='active'&&Date.parse(user.membership.expiresAt)>now);
}
// Already-issued storage URLs remain usable until their short expiry.
export function memberAssetLifetime(user,maximum=60,now=Date.now()){
 if(user?.isAdmin)return maximum;
 if(!canReadMemberContent(user,now))return 0;
 return Math.max(0,Math.min(maximum,Math.floor((Date.parse(user.membership.expiresAt)-now)/1000)));
}
