const logger = require('firebase-functions/logger')
const { getFirestore } = require('firebase-admin/firestore')
const ecomClient = require('@ecomplus/client')

module.exports = async ({ appSdk }) => {
  const d = new Date()
  // double checking paid orders after 10 min
  const newDate = new Date(d.getTime() + 600000)
  const db = getFirestore()
  const snapshot = await db.collection('cart_reserve')
    .where('queuedAt', '<=', newDate)
    .orderBy('queuedAt')
    .get()
  const { docs } = snapshot
  logger.info(`${docs.length} carts`)
  let auth
  for (let i = 0; i < docs.length; i++) {
    const { storeId, completed, items } = docs[i].data()
    await appSdk.getAuth(storeId)
      .then(async (authStore) => {auth = authStore})
      .catch(error => { console.log('Não autenticou'); console.error(error)})
    const cartId = docs[i].ref.id
    console.log('running', cartId)
    if (Array.isArray(items) && items.length) {
      const uniqueProducts = items.filter((obj, index) => {
        return index === items.findIndex(o => obj.product_id === o.product_id);
      });
      const products = []
      for (let index = 0; index < uniqueProducts.length; index++) {
        const { data } = await ecomClient.store({ url: `/products/${uniqueProducts[index].product_id}.json`, authenticationId: auth.myId, accessToken: auth.accessToken, method: 'get', storeId})
          if (data) {
            products.push(data)
          }
      }
      for (let ii = 0; ii < items.length; ii++) {
        const item = items[ii];
        const indexProduct = products.findIndex(({ _id }) => _id === item.product_id)
        console.log('index encontrado', indexProduct)
      if (indexProduct >= 0) {
        endpoint = `/products/${item.product_id}.json`
        let quantity, metafield, metafieldIndex
        const hitProduct = products[indexProduct]
        if (hitProduct.variations && hitProduct.variations.length) {
          const variation = hitProduct.variations.find(({ _id }) => _id === item.variation_id)
          quantity = variation.quantity
          metafields = hitProduct.metafields
          if (metafields && metafields.length) {
            metafieldIndex = metafields.findIndex(field => field.namespace === item.variation_id)
            if (metafieldIndex >= 0) {
              metafield = metafields[metafieldIndex]
              quantity = Number(metafield.value)
              quantity += item.quantity
              console.log(`#${storeId} - aumentar - ${endpoint} - ${quantity}`)
              metafields[metafieldIndex].value = String(quantity)
            }
          }
        } else {
          quantity = hitProduct && hitProduct.quantity || 0
          quantity += item.quantity
          metafields = hitProduct.metafields
          if (metafields && metafields.length) {
            metafieldIndex = metafields.findIndex(field => field.namespace === item.product_id)
            if (metafieldIndex >= 0) {
              metafield = metafields[metafieldIndex]
              quantity = Number(metafield.value)
              quantity += item.quantity
              console.log(`#${storeId} - ${endpoint} - ${quantity}`)
              metafields[metafieldIndex].value = String(quantity)
            }
          }
        }
        await appSdk.apiRequest(storeId, endpoint, 'PATCH', { metafields: products[indexProduct].metafields }, auth)
      }
        
      }
      await docs[i].ref.delete()
    }
    await docs[i].ref.delete()
  }
}
